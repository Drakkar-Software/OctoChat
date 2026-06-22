/**
 * Requester-side lookup helpers for desk "invite" nodes — tickets and shared rooms.
 *
 * A requester is ISOLATED to their own node (never the desk space index), so they cannot
 * enumerate grants through the all-member object index. Instead, the per-node grant accepted
 * via (`acceptResourceGrant` → `acceptNodeInvite`) is persisted in the local space-access
 * store keyed `${spaceId}:${nodeId}`. This module reads that store to surface what nodes the
 * requester has been granted.
 *
 * Also provides thin wrappers around the generic `submitResourceRequest` / `scanResourceGrants`
 * / `acceptResourceGrant` primitives that:
 *  - Accept a raw request link URL string (decoding it internally).
 *  - Hard-code the correct `nodeType` so call sites can't mistype it.
 *
 * The store is an in-memory snapshot; the caller MUST have hydrated it from KV at boot
 * (`hydrateSpaceAccessStore`) for this to see grants from a previous session.
 */
import {
  localSpaceAccessEntries,
  submitResourceRequest,
  scanResourceGrants,
  scanResourceRejects,
  acceptResourceGrant,
  addJoinedSpace,
  buildSpace,
} from '@drakkar.software/octospaces-sdk';
import type { ResourceGrant, ResourceReject } from '@drakkar.software/octospaces-sdk';

import { readSpaces, recordOutgoingRequest, setOutgoingRequestRefused } from '../starfish/registry';
import type { OutgoingRequest } from '../domain/types';

import type { Session } from '../starfish/identity';
import { decodeRequestLink } from '../starfish/dm-link';
import { isTicketRoomId, clampField, TICKET_TITLE_MAX, TICKET_REQUESTER_MAX } from './ticket';
import { readSealedTicketInfo } from './ticket-info';
import { isSharedRoomId } from './shared-room';

export interface RequesterTicket {
  /** The ticket room/node id (`ticket-<hex>`). */
  nodeId: string;
  /** Sealed ticket subject, or '' when it isn't (yet) readable by this requester. */
  title: string;
}

/** Node ids matching `predicate` that the requester holds a per-node grant for, in this space. */
function nodeIdsForSpace(spaceId: string, predicate: (id: string) => boolean): string[] {
  const prefix = `${spaceId}:`;
  const ids: string[] = [];
  for (const key of Object.keys(localSpaceAccessEntries())) {
    if (!key.startsWith(prefix)) continue;
    const nodeId = key.slice(prefix.length);
    // Each accepted node writes sibling keys too (`${spaceId}:${nodeId}:stream` and
    // `:keyring`); skip them so we don't surface phantom node ids.
    if (nodeId.includes(':')) continue;
    if (predicate(nodeId)) ids.push(nodeId);
  }
  return ids.sort();
}

/**
 * REQUESTER: resolve this requester's single existing ticket in a space, or null if none.
 *
 * Reads the local access store only (no server round-trip to find the node) — so it returns
 * a ticket only AFTER the requester accepted the grant. Enforces "one ticket per space": if
 * several ticket grants are somehow present, the first (stable-sorted) is returned.
 */
export async function getRequesterTicketForSpace(
  session: Session,
  spaceId: string,
): Promise<RequesterTicket | null> {
  const ids = nodeIdsForSpace(spaceId, isTicketRoomId);
  if (ids.length === 0) return null;
  const nodeId = ids[0];
  const info = await readSealedTicketInfo(session, spaceId, nodeId).catch(() => null);
  return { nodeId, title: info?.title ?? '' };
}

// ── Shared-room lookup ──────────────────────────────────────────────────────────

/** A shared room (guest invite room) the requester has been granted access to. */
export interface RequesterSharedRoom {
  /** The shared room id (`shared-<hex>`). */
  nodeId: string;
  /** The room title as stored in the object index. */
  title: string;
}

/**
 * REQUESTER: list all shared rooms (guest invite rooms) this requester holds per-node grants
 * for in the given space. Returns rooms in stable-sorted order.
 *
 * Unlike tickets (one-per-space), a requester may have multiple shared rooms in the same space
 * (e.g. a contractor with access to several project rooms). The `title` comes from the node
 * index — shared rooms are always plaintext (`enc:false`) so titles are readable.
 */
export function getRequesterSharedRoomsForSpace(spaceId: string): RequesterSharedRoom[] {
  return nodeIdsForSpace(spaceId, isSharedRoomId).map((nodeId) => ({
    nodeId,
    // Title is not locally recoverable without a round-trip; callers that need it should
    // read it from the granted node's index entry. Return the id as a fallback.
    title: '',
  }));
}

// ── Submit helpers ──────────────────────────────────────────────────────────────

/** Options shared by both room and ticket request submissions. */
export interface SubmitNodeRequestBaseOpts {
  /** A label for yourself so the owner knows who is requesting (e.g. display name or email).
   *  Shown in the Requests shelf. Clamped to 320 chars. */
  requester: string;
  /** Optional plain-text message to the owner, visible in the Requests shelf. */
  message?: string;
}

/** Options for filing a shared-room request via a request link. */
export interface SubmitRoomRequestOpts extends SubmitNodeRequestBaseOpts {
  /** Desired room name. Clamped to 200 chars. */
  title: string;
}

/** Options for filing a ticket request via a request link. */
export interface SubmitTicketRequestOpts extends SubmitNodeRequestBaseOpts {
  /** Ticket subject / title. Clamped to 200 chars. */
  title: string;
  /** Triage hint forwarded in `req.meta.priority`. */
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * Decode a request link, seal a `nodeType` request to the owner's KEM key and append it
 * anonymously to their inbox — no space membership needed. Returns a `reqId` the caller can
 * save to poll for fulfilment via {@link claimGrantedNodes}. Backs both submit wrappers below;
 * `extraMeta` carries any node-type-specific request metadata (e.g. a ticket's `priority`).
 */
async function submitNodeRequest(
  session: Session,
  requestLink: string,
  nodeType: 'room' | 'ticket',
  opts: SubmitRoomRequestOpts | SubmitTicketRequestOpts,
  extraMeta?: Record<string, unknown>,
): Promise<{ reqId: string; spaceId: string }> {
  const { identity, spaceId } = decodeRequestLink(requestLink);
  if (!spaceId) throw new Error('Request link is missing the target space id (?s=…).');
  const { reqId } = await submitResourceRequest(session, identity, {
    spaceId,
    nodeType,
    title: clampField(opts.title, TICKET_TITLE_MAX),
    meta: { requester: clampField(opts.requester, TICKET_REQUESTER_MAX), ...extraMeta },
    message: opts.message,
  });
  // Persist the outgoing request so the requester can track its status (pending → refused)
  // across restarts and devices, via the `_spaces` doc `extra.outgoingRequests` field.
  await recordOutgoingRequest(session.spacesRegistryClient, session.userId, reqId, {
    spaceId,
    nodeType,
    title: clampField(opts.title, TICKET_TITLE_MAX),
    ts: Date.now(),
  });
  return { reqId, spaceId };
}

/**
 * File a request for a **private shared room** into a space the requester is NOT a member of.
 *
 * Decodes the request link URL, verifies the owner's identity binding online, seals the request
 * to the owner's KEM key and appends it anonymously to their inbox — no space membership needed.
 * Returns a `reqId` the caller can save to poll for fulfilment via {@link claimGrantedNodes}.
 *
 * @param session     The requester's own authenticated session.
 * @param requestLink The full request link URL (`…/request?s=<spaceId>#<token>`).
 */
export function submitRoomRequest(
  session: Session,
  requestLink: string,
  opts: SubmitRoomRequestOpts,
): Promise<{ reqId: string; spaceId: string }> {
  return submitNodeRequest(session, requestLink, 'room', opts);
}

/**
 * File a **support-ticket** request into a space the requester is NOT a member of.
 * Mirrors {@link submitRoomRequest} but sets `nodeType:'ticket'` and forwards `priority`.
 */
export function submitTicketRequest(
  session: Session,
  requestLink: string,
  opts: SubmitTicketRequestOpts,
): Promise<{ reqId: string; spaceId: string }> {
  return submitNodeRequest(session, requestLink, 'ticket', opts, opts.priority ? { priority: opts.priority } : undefined);
}

// ── Claim helper ────────────────────────────────────────────────────────────────

/**
 * Scan the session's inbox for accepted grants (the owner accepted one or more requests) and
 * claim each by persisting the per-node caps + registering a synthetic Space entry so the
 * granted node appears in the guest-rooms section. Returns the list of newly claimed grants.
 *
 * Best-effort: a corrupt/duplicate grant is skipped, not thrown.
 * Pass `seenReqIds` (from persisted state) to skip already-processed grants.
 */
// Re-export so app-side hook imports stay from octochat-sdk only.
export type { ResourceReject };

/**
 * Scan the session's inbox for declined requests (the owner rejected one or more requests)
 * and durably mark each as refused in the requester's `_spaces` registry. Returns the list
 * of newly-seen rejections.
 *
 * Best-effort: a corrupt/duplicate reject is skipped, not thrown.
 * Pass `seenReqIds` (from persisted state) to skip already-processed rejections.
 */
export async function claimRejectedRequests(
  session: Session,
  opts: { seenReqIds?: Set<string> } = {},
): Promise<ResourceReject[]> {
  const rejects = await scanResourceRejects(session, { seenReqIds: opts.seenReqIds });
  const claimed: ResourceReject[] = [];
  for (const reject of rejects) {
    try {
      await setOutgoingRequestRefused(session.spacesRegistryClient, session.userId, reject.reqId);
      claimed.push(reject);
    } catch {
      // best-effort; a failed registry write must not block other rejections
    }
  }
  return claimed;
}

/**
 * Return all outgoing requests (filed by this requester) for a given space, newest-first.
 * Reads the durable `_spaces` registry — survives restart and is cross-device.
 * Returns `[]` when the user has not filed any requests for the space.
 */
export async function getOutgoingRequestsForSpace(
  session: Session,
  spaceId: string,
): Promise<Array<{ reqId: string } & OutgoingRequest>> {
  const { outgoingRequests } = await readSpaces(session.spacesRegistryClient, session.userId);
  return Object.entries(outgoingRequests)
    .filter(([, r]) => r.spaceId === spaceId)
    .map(([reqId, r]) => ({ reqId, ...r }))
    .sort((a, b) => b.ts - a.ts);
}

export async function claimGrantedNodes(
  session: Session,
  opts: { seenReqIds?: Set<string> } = {},
): Promise<ResourceGrant[]> {
  const grants = await scanResourceGrants(session, { seenReqIds: opts.seenReqIds });
  const claimed: ResourceGrant[] = [];
  for (const grant of grants) {
    try {
      await acceptResourceGrant(session, grant);
      // `acceptResourceGrant` stores the per-node caps but does NOT inject a synthetic
      // Space into `_spaces.spaces` (unlike `joinNodeByLink` which does). Do it here
      // so the granted node appears in the app's guest-rooms section after a refresh.
      // The node name comes from the bundle JSON that was already verified by acceptResourceGrant.
      let nodeName = grant.nodeId;
      try {
        const bundle = JSON.parse(grant.bundle) as { nodeName?: unknown };
        if (typeof bundle?.nodeName === 'string' && bundle.nodeName) nodeName = bundle.nodeName;
      } catch {
        // Malformed bundle — caps are already stored; fall back to nodeId as display name.
      }
      await addJoinedSpace(
        session.spacesRegistryClient,
        session.userId,
        buildSpace(grant.nodeId, nodeName),
      ).catch(() => {
        // Space injection is best-effort: the caps are already stored; if the spaces
        // doc update fails (offline, conflict), the next session will re-hydrate from caps.
      });
      claimed.push(grant);
    } catch {
      // best-effort; a corrupt or duplicate grant must not block others
    }
  }
  return claimed;
}
