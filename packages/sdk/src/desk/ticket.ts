/**
 * Ticket model — pure data helpers for desk/ticket ObjectNodes.
 *
 * A ticket IS a room (`type: 'ticket'`), whose conversation is the existing
 * append-only stream log. This module owns the `TicketMeta` shape stored at
 * `ObjectNode.meta.ticket` and the pure helpers that read/write it.
 * No React. No platform deps. No network calls.
 */
import type { ID, ObjectNode } from '../domain/types';

export type TicketStatus = 'open' | 'pending' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Stored at `ObjectNode.meta.ticket` for every ticket node. */
export interface TicketMeta {
  status: TicketStatus;
  priority: TicketPriority;
  /** Space-member userId of the assignee, or null when unassigned. */
  assigneeId: ID | null;
  /** Display name or email of the requester (may be a non-space-member).
   *  PII — omitted from the all-member index for E2EE tickets (sealed instead). */
  requester: string;
  /** The ticket subject. Lives in `meta` (not `node.title`, which the index strips for
   *  invite nodes) — omitted from the index for E2EE tickets (sealed instead). */
  title: string;
  /** Epoch-ms deadline for SLA; null when no SLA is set. */
  slaDueAt: number | null;
}

/** The human-readable, possibly-sensitive fields. For E2EE tickets these are stripped from
 *  the plaintext index and sealed into the per-node stream instead (see `desk/ticket-info`). */
export interface TicketInfo {
  title: string;
  requester: string;
}

/** Max lengths for index/sealed strings — bounds storage-amplification + index bloat. */
export const TICKET_TITLE_MAX = 200;
export const TICKET_REQUESTER_MAX = 320; // RFC 5321 max email length

/** Clamp a free-text field to a max length (and drop control chars). */
export function clampField(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

/**
 * Project a ticket's `meta.ticket` for storage in the ALL-MEMBER plaintext index.
 * Plaintext tickets keep every field; E2EE tickets STRIP `title` + `requester` (those are
 * sealed into the per-node stream so they never touch the plaintext index).
 */
export function ticketMetaForIndex(meta: TicketMeta, enc: boolean): TicketMeta {
  if (!enc) return meta;
  return { ...meta, title: '', requester: '' };
}

/** Extract `TicketMeta` from a node's `meta.ticket` field; null if absent or wrong type. */
export function ticketOf(node: ObjectNode): TicketMeta | null {
  if (node.type !== 'ticket') return null;
  const t = node.meta?.ticket as TicketMeta | undefined;
  return t ?? null;
}

/** Return node with `meta.ticket` merged from `patch`. */
export function withTicket(node: ObjectNode, patch: Partial<TicketMeta>): ObjectNode {
  const current: TicketMeta = ticketOf(node) ?? {
    status: 'open',
    priority: 'medium',
    assigneeId: null,
    requester: '',
    title: '',
    slaDueAt: null,
  };
  return { ...node, meta: { ...node.meta, ticket: { ...current, ...patch } } };
}

/** True when the node is a ticket node. */
export function isTicketNode(node: ObjectNode): boolean {
  return node.type === 'ticket';
}

/** Build the initial `TicketMeta` for a newly created ticket. Title + requester are clamped
 *  (length/control-char bounds) — they may be attacker-controlled (e.g. a public webhook). */
export function defaultTicketMeta(opts: { title: string; requester: string; priority?: TicketPriority }): TicketMeta {
  return {
    status: 'open',
    priority: opts.priority ?? 'medium',
    assigneeId: null,
    requester: clampField(opts.requester, TICKET_REQUESTER_MAX),
    title: clampField(opts.title, TICKET_TITLE_MAX),
    slaDueAt: null,
  };
}
