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
  /** Display name or email of the requester (may be a non-space-member). */
  requester: string;
  /** Epoch-ms deadline for SLA; null when no SLA is set. */
  slaDueAt: number | null;
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
    slaDueAt: null,
  };
  return { ...node, meta: { ...node.meta, ticket: { ...current, ...patch } } };
}

/** True when the node is a ticket node. */
export function isTicketNode(node: ObjectNode): boolean {
  return node.type === 'ticket';
}

/** Build the initial `TicketMeta` for a newly created ticket. */
export function defaultTicketMeta(opts: { requester: string; priority?: TicketPriority }): TicketMeta {
  return {
    status: 'open',
    priority: opts.priority ?? 'medium',
    assigneeId: null,
    requester: opts.requester,
    slaDueAt: null,
  };
}
