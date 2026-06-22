/**
 * Owner-side handling of incoming sealed ticket requests, driven by each space's
 * {@link IntakeConfig}. A non-member files a request into the owner's inbox using only the
 * owner's PUBLIC identity link (see `submitResourceRequest`); this is where the owner turns
 * those requests into tickets.
 *
 *   manual      → leave requests pending (the Requests UI accepts/declines them by hand)
 *   auto-accept → create a ticket for each request
 *   auto-reply  → create the ticket, then post a first reply — AI-written when an on-device
 *                 engine is wired (`configureLlm`), otherwise the configured fixed message
 *
 * Idempotent: `scanResourceRequests` skips requests already turned into a ticket (matched by
 * `meta.reqId` in the space index), so re-running the reconcile never double-creates.
 */
import {
  acceptResourceRequest,
  getNodeStreamClient,
  rejectResourceRequest,
  scanResourceRequests,
  type PendingRequest,
  type ResourceRequest,
} from '@drakkar.software/octospaces-sdk';

import { isLlmConfigured, runLlm } from '../ai/engine-port';
import { randomId } from '../domain/ids';
import type { Session } from '../starfish/identity';
import { objInvLogPush } from '../starfish/paths';
import { readSpaces, setRequestDeclined } from '../starfish/registry';
import { readIntakeConfig, type IntakeConfig } from './intake-config';
import { makeTicketCreateHandler, makeRoomCreateHandler } from './orchestrator';

/** The fallback first reply when auto-reply has no fixed text and no AI engine is available. */
export const DEFAULT_INTAKE_REPLY =
  "Thanks for reaching out — we've logged your request and will reply shortly.";

/**
 * The auto-reply text for a request: AI-written when `replyKind: 'ai'` AND an on-device engine
 * is wired; otherwise the configured fixed message (or {@link DEFAULT_INTAKE_REPLY} if blank).
 */
export async function composeIntakeReply(cfg: IntakeConfig, req: ResourceRequest): Promise<string> {
  if (cfg.replyKind === 'ai' && isLlmConfigured()) {
    try {
      const out = await runLlm([
        {
          role: 'system',
          content:
            'You are a support-desk assistant. Warmly acknowledge the request in one or two short ' +
            'sentences. Do not promise a timeline or a resolution.',
        },
        { role: 'user', content: `New request: ${req.title}\n\n${req.message ?? ''}`.trim() },
      ]);
      const text = out.trim();
      if (text) return text;
    } catch {
      // engine unavailable or generation failed — fall back to the fixed message
    }
  }
  return cfg.replyText.trim() || DEFAULT_INTAKE_REPLY;
}

/**
 * Accept pending ticket requests for `spaceIds`, each per its own {@link IntakeConfig}:
 * manual-mode spaces are left for the Requests UI; auto-accept / auto-reply spaces get their
 * requests turned into tickets (auto-reply also posts a first reply). Pass the spaces in view
 * (e.g. the rail) — requests only land in the caller's OWN inbox, so non-owned spaces simply
 * have none, and a space whose config can't be read (not ours / offline) is skipped.
 * Best-effort throughout; idempotent (scanResourceRequests skips already-created reqIds).
 * Returns `true` if anything was accepted (so the caller can refresh the ticket list).
 */
export async function reconcileTicketRequests(
  session: Session,
  spaceIds: ReadonlySet<string>,
): Promise<boolean> {
  if (spaceIds.size === 0) return false;

  // ONE inbox scan for all the given spaces (the inbox is the caller's own).
  let pending: PendingRequest[];
  try {
    pending = await scanResourceRequests(session, spaceIds);
  } catch {
    return false; // inbox unreadable (offline) — retry next refresh
  }
  if (pending.length === 0) return false;

  const cfgBySpace = new Map<string, IntakeConfig | null>(); // null = unreadable / not ours → skip
  let changed = false;

  for (const p of pending) {
    const spaceId = p.req.spaceId;
    if (!cfgBySpace.has(spaceId)) {
      try {
        cfgBySpace.set(spaceId, await readIntakeConfig(session, spaceId));
      } catch {
        cfgBySpace.set(spaceId, null);
      }
    }
    const cfg = cfgBySpace.get(spaceId) ?? null;
    if (!cfg || cfg.mode === 'manual') continue; // manual → handled by the Requests UI

    try {
      // Route to the appropriate node creator by request type (inside try so an unknown
      // nodeType skips this request without aborting the rest of the batch).
      const create = makeNodeCreateHandler(p.req.nodeType, cfg);
      const { nodeId } = await acceptResourceRequest(session, p, { create });
      changed = true;
      if (cfg.mode === 'auto-reply' && p.req.nodeType !== 'room') {
        const text = await composeIntakeReply(cfg, p.req);
        const env = { t: 'msg', e: { id: randomId(), authorId: session.userId, ts: Date.now(), text } };
        // The owner holds the per-node objinvlog cap (established at ticket creation). The ticket
        // is plaintext, so the reply is posted unsealed — where the app reads it.
        await getNodeStreamClient(spaceId, nodeId, session).append(
          objInvLogPush(spaceId, nodeId),
          env as unknown as Record<string, unknown>,
        );
      }
    } catch {
      // best-effort: a bad/failed request must not block the others
    }
  }
  return changed;
}

/**
 * List a space's pending (not-yet-accepted, not-yet-declined) ticket requests — for the manual
 * Requests UI. Filters out any request the owner has previously declined (persisted in the
 * `_spaces` doc) so declined requests don't reappear after a refresh.
 */
export async function listPendingTicketRequests(session: Session, spaceId: string): Promise<PendingRequest[]> {
  const [all, { declinedRequests }] = await Promise.all([
    scanResourceRequests(session, new Set([spaceId])),
    readSpaces(session.spacesRegistryClient, session.userId),
  ]);
  return all.filter((p) => !declinedRequests[p.req.reqId]);
}

/**
 * Pick a node-create handler for `acceptResourceRequest` based on `nodeType`.
 *   `'room'`   → shared invite room (isolated, cap-gated channel)
 *   `'ticket'` → OctoDesk ticket node
 *   anything else → throws so unknown types are surfaced, not silently misclassified
 * `cfg` is passed so per-space settings (e.g. enc toggle in Phase 5) can be read here.
 */
function makeNodeCreateHandler(nodeType: string, cfg: IntakeConfig) {
  if (nodeType === 'room') return makeRoomCreateHandler({ enc: (cfg as { enc?: boolean }).enc ?? false });
  if (nodeType === 'ticket') return makeTicketCreateHandler();
  throw new Error(`Unknown request nodeType: ${JSON.stringify(nodeType)}`);
}

/** Accept a single pending request → create the appropriate node (ticket or shared room)
 *  based on `pending.req.nodeType`. The manual-mode counterpart of the reconcile loop.
 *  Returns the created node's spaceId + nodeId. */
export async function acceptNodeRequest(
  session: Session,
  pending: PendingRequest,
): Promise<{ spaceId: string; nodeId: string }> {
  const create = makeNodeCreateHandler(pending.req.nodeType, { mode: 'manual', replyKind: 'fixed', replyText: '' });
  return acceptResourceRequest(session, pending, { create });
}

/** @deprecated Use {@link acceptNodeRequest} — handles both ticket and room requests. */
export const acceptTicketRequest = acceptNodeRequest;

/**
 * Decline a pending request: seals a rejection to the requester AND persists the reqId in the
 * owner's `_spaces` doc so `listPendingTicketRequests` filters it out on the next refresh.
 */
export async function declineTicketRequest(
  session: Session,
  pending: PendingRequest,
  reason?: string,
): Promise<void> {
  await rejectResourceRequest(session, pending, reason);
  await setRequestDeclined(session.spacesRegistryClient, session.userId, pending.req.reqId);
}
