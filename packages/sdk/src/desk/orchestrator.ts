/**
 * High-level desk operations. These compose `createTicketNode`/`patchTicketMeta`
 * with the per-node invite-link flow from `octospaces-sdk`, so callers (webhooks,
 * app flows) never touch ObjectNode internals.
 *
 * Access model (both tiers ISOLATE the requester to their own ticket node — never
 * the space index or other tickets):
 *  - Plaintext ticket → `enc: false`. Per-node content + stream caps, cap-gated
 *    server-side; messages are stored plaintext.
 *  - E2EE ticket (memberTicket: true) → `enc: true`. The ticket gets its OWN
 *    per-node keyring (CEK wrapped only to the ticket's participants — requester +
 *    owner/bot, plus agents on assignment); the requester decrypts via that keyring
 *    WITHOUT ever holding the space-wide key. No space membership required.
 *
 * The `makeTicketCreateHandler` factory returns a `create` callback compatible
 * with `acceptResourceRequest({ create })` so an OctoDesk bot can accept sealed
 * resource requests and create properly-typed ticket nodes with `TicketMeta`.
 */
import { createNodeInviteLink, addNodeKeyringRecipient, removeNodeKeyringRecipient, readProfile } from '@drakkar.software/octospaces-sdk';
import type { ResourceRequest } from '@drakkar.software/octospaces-sdk';
import { randomId } from '../domain/ids';
import type { Session } from '../starfish/identity';
import type { ID } from '../domain/types';
import type { TicketPriority, TicketStatus } from './ticket';
import { defaultTicketMeta } from './ticket';
import { createTicketNode, createTicketNodeWithReqId, patchTicketMeta } from './registry-write';
import { writeSealedTicketInfo } from './ticket-info';

/**
 * Create a new ticket room and return a one-time invite link for the requester.
 * The caller MUST pass a session that is already a space member (e.g. the desk
 * bot session whose credential was enrolled via the automation setup flow).
 *
 * `inviteLinkOrigin` is the scheme+host for the deep-link URL, e.g.
 * `'https://desk.drakkar.software'` (provided at call-site so the SDK stays
 * origin-agnostic).
 */
export async function createTicket(
  session: Session,
  spaceId: string,
  opts: {
    title: string;
    requester: string;
    priority?: TicketPriority;
    /** true → enc: true (E2EE via the ticket's OWN per-node keyring). Default: false. */
    memberTicket?: boolean;
    inviteLinkOrigin: string;
  },
): Promise<{ ticketId: ID; requesterInviteLink: string }> {
  const ticketId = `ticket-${randomId()}`;
  const enc = opts.memberTicket ?? false;
  const ticketMeta = defaultTicketMeta({ title: opts.title, requester: opts.requester, priority: opts.priority });

  await createTicketNode(session, spaceId, ticketId, ticketMeta, enc);

  const { link } = await createNodeInviteLink(
    session,
    spaceId,
    ticketId,
    opts.title,
    { enc },
    true,
    opts.inviteLinkOrigin,
    // ALWAYS isolate: a ticket requester must reach only their own ticket node, never the
    // desk space index or other tickets. For enc tickets `isolated` ALSO selects the
    // per-node keyring (E2EE without the space-wide key); for plaintext it withholds the
    // space cap. (octospaces-sdk ≥0.12.6.)
    { isolated: true },
  );

  // E2EE ticket: title + requester were stripped from the plaintext index — seal them into
  // the per-node stream so participants (requester + desk) can recover them. The node keyring
  // now exists (created by createNodeInviteLink) and this session is a recipient.
  if (enc) {
    await writeSealedTicketInfo(session, spaceId, ticketId, { title: opts.title, requester: opts.requester });
  }

  return { ticketId, requesterInviteLink: link };
}

/** Update the status of an existing ticket. */
export async function patchTicketStatus(
  session: Session,
  spaceId: string,
  ticketId: ID,
  status: TicketStatus,
): Promise<void> {
  await patchTicketMeta(session, spaceId, ticketId, { status });
}

/**
 * Assign (or unassign) a ticket to a space member.
 *
 * For an **E2EE ticket** (`opts.enc`), assigning also grants the assignee CRYPTOGRAPHIC
 * access by adding their KEM key (from their public profile) to the ticket's per-node
 * keyring — so the agent can decrypt the conversation. Least-privilege: an unassigned agent
 * holds no key until assigned. The caller MUST already hold the node keyring (the desk
 * owner/bot, which created the ticket); a non-recipient cannot grant access.
 *
 * Note: unassigning here only clears `assigneeId` — it does NOT rotate the keyring (the
 * former assignee keeps access to messages already seen). Key rotation on unassignment is
 * Phase 5.
 */
export async function assignTicket(
  session: Session,
  spaceId: string,
  ticketId: ID,
  assigneeId: ID | null,
  opts: { enc?: boolean } = {},
): Promise<void> {
  await patchTicketMeta(session, spaceId, ticketId, { assigneeId });

  if (opts.enc && assigneeId) {
    const profile = await readProfile(assigneeId);
    if (!profile.kemPub) {
      throw new Error(
        `Cannot grant E2EE ticket access: assignee ${assigneeId} has no published encryption key.`,
      );
    }
    await addNodeKeyringRecipient(session, spaceId, ticketId, {
      subKem: profile.kemPub,
      userId: assigneeId,
    });
  }
}

/**
 * REVOKE an agent's access to an E2EE ticket (e.g. on unassignment or off-boarding):
 * rotates the ticket's per-node keyring so the agent can no longer decrypt FUTURE messages.
 * Already-seen messages remain readable (forward secrecy only — they can't be un-seen).
 *
 * The caller MUST already hold the node keyring (the desk owner/bot). Returns the new epoch.
 * No-op-safe for plaintext tickets (there is no keyring) — only call for `enc` tickets.
 */
export async function revokeTicketAgent(
  session: Session,
  spaceId: string,
  ticketId: ID,
  agentUserId: ID,
): Promise<{ newEpoch: number }> {
  const profile = await readProfile(agentUserId);
  if (!profile.kemPub) {
    throw new Error(`Cannot revoke ${agentUserId}: no published encryption key.`);
  }
  return removeNodeKeyringRecipient(session, spaceId, ticketId, [profile.kemPub]);
}

/**
 * Factory: returns a `create` callback for use with `acceptResourceRequest({ create })`.
 *
 * The callback interprets a `ResourceRequest` (nodeType `'ticket'` by convention)
 * and creates a properly-typed ticket node with `TicketMeta` — forwarding the
 * `requester` string and `priority` from `req.meta`, and stamping `meta.reqId` for
 * idempotency. Use this to wire a desk bot's reconcile loop:
 *
 * ```ts
 * const ticketHandler = makeTicketCreateHandler();
 * for (const pending of await scanResourceRequests(session)) {
 *   await acceptResourceRequest(session, pending, { create: ticketHandler });
 * }
 * ```
 */
export function makeTicketCreateHandler(): (
  session: Session,
  req: ResourceRequest,
) => Promise<{ nodeId: string }> {
  return async (session: Session, req: ResourceRequest) => {
    const ticketId = `ticket-${randomId()}`;
    const requester =
      typeof req.meta?.requester === 'string' ? (req.meta.requester as string) : req.requester.userId;
    const priority =
      typeof req.meta?.priority === 'string'
        ? (req.meta.priority as TicketPriority)
        : 'medium';
    const ticketMeta = defaultTicketMeta({ title: req.title, requester, priority });
    // Create the ticket node with BOTH the TicketMeta sub-object AND meta.reqId so the
    // dedup check in scanResourceRequests (which tests node.meta?.reqId === req.reqId)
    // correctly skips re-delivered requests. (Resource-request tickets are plaintext.)
    await createTicketNodeWithReqId(session, req.spaceId, ticketId, ticketMeta, false, req.reqId);
    return { nodeId: ticketId };
  };
}
