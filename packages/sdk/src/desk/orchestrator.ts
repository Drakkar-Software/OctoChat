/**
 * High-level desk operations. These compose `createTicketNode`/`patchTicketMeta`
 * with the per-node invite-link flow from `octospaces-sdk`, so callers (webhooks,
 * app flows) never touch ObjectNode internals.
 *
 * Access model:
 *  - Non-member requester → `enc: false` (plaintext, but per-node cap enforced
 *    server-side). The returned `requesterInviteLink` gives the requester access
 *    to their ticket only.
 *  - Member requester (memberTicket: true) → `enc: true` (full E2EE under space
 *    keyring). Requester must already hold the keyring (i.e. be a space member).
 *
 * The `makeTicketCreateHandler` factory returns a `create` callback compatible
 * with `acceptResourceRequest({ create })` so an OctoDesk bot can accept sealed
 * resource requests and create properly-typed ticket nodes with `TicketMeta`.
 */
import { createNodeInviteLink } from '@drakkar.software/octospaces-sdk';
import type { ResourceRequest } from '@drakkar.software/octospaces-sdk';
import { randomId } from '../domain/ids';
import type { Session } from '../starfish/identity';
import type { ID } from '../domain/types';
import type { TicketPriority, TicketStatus } from './ticket';
import { defaultTicketMeta } from './ticket';
import { createTicketNode, createTicketNodeWithReqId, patchTicketMeta } from './registry-write';

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
    /** true → enc: true (requester must hold the space keyring). Default: false. */
    memberTicket?: boolean;
    inviteLinkOrigin: string;
  },
): Promise<{ ticketId: ID; requesterInviteLink: string }> {
  const ticketId = `ticket-${randomId()}`;
  const enc = opts.memberTicket ?? false;
  const ticketMeta = defaultTicketMeta({ requester: opts.requester, priority: opts.priority });

  await createTicketNode(session, spaceId, ticketId, opts.title, ticketMeta, enc);

  const { link } = await createNodeInviteLink(
    session,
    spaceId,
    ticketId,
    opts.title,
    { enc },
    true,
    opts.inviteLinkOrigin,
    // Non-member requesters (enc:false) must reach only their own ticket — not the full
    // desk space index. enc:true tickets are already space members so isolated is a no-op.
    { isolated: !enc },
  );

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

/** Assign (or unassign) a ticket to a space member. */
export async function assignTicket(
  session: Session,
  spaceId: string,
  ticketId: ID,
  assigneeId: ID | null,
): Promise<void> {
  await patchTicketMeta(session, spaceId, ticketId, { assigneeId });
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
    const ticketMeta = defaultTicketMeta({ requester, priority });
    // Create the ticket node with BOTH the TicketMeta sub-object AND meta.reqId so the
    // dedup check in scanResourceRequests (which tests node.meta?.reqId === req.reqId)
    // correctly skips re-delivered requests.
    await createTicketNodeWithReqId(session, req.spaceId, ticketId, req.title, ticketMeta, false, req.reqId);
    return { nodeId: ticketId };
  };
}
