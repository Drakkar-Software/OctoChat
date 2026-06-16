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
 */
import { createNodeInviteLink } from '@drakkar.software/octospaces-sdk';
import { randomId } from '../domain/ids';
import type { Session } from '../starfish/identity';
import type { ID } from '../domain/types';
import type { TicketPriority, TicketStatus } from './ticket';
import { defaultTicketMeta } from './ticket';
import { createTicketNode, patchTicketMeta } from './registry-write';

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
