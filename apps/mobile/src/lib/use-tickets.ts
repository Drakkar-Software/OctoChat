import { useCallback, useMemo } from 'react';
import { useObjects } from './use-objects';
import { useUnread } from './unread-context';
import { ticketOf, withTicket } from '@drakkar.software/octochat-sdk';
import type { ObjectNode } from '@drakkar.software/octochat-sdk';
import type { TicketMeta, TicketStatus } from '@drakkar.software/octochat-sdk';

export interface TicketEntry {
  node: ObjectNode;
  ticket: TicketMeta;
  /** Unread message count for this ticket's room. Zero when caught up. */
  unread: number;
}

/**
 * Returns all ticket nodes in a space, projected from the unified object index.
 * Ticket rooms are ObjectNode with type === 'ticket'. Unread counts are overlaid
 * from {@link useUnread} (ticket ids match room ids, so the unread map covers them).
 * Exposes optimistic {@link setStatus} and {@link archive} mutators backed by the
 * object-index merge-doc (same pattern as {@link useRooms} category mutations).
 */
export function useTickets(spaceId: string | null): {
  tickets: TicketEntry[];
  loading: boolean;
  setStatus: (ticketId: string, status: TicketStatus) => void;
  archive: (ticketId: string) => void;
} {
  const { nodes, ready, mutate, archive: archiveNode } = useObjects(spaceId ?? '', { enabled: !!spaceId });
  const { unreadByRoom } = useUnread();

  const tickets = useMemo<TicketEntry[]>(
    () =>
      nodes
        .filter((n) => n.type === 'ticket')
        .map((n) => ({
          node: n,
          ticket: ticketOf(n) ?? { status: 'open', priority: 'medium', assigneeId: null, requester: '', slaDueAt: null },
          unread: unreadByRoom[n.id] ?? 0,
        })),
    [nodes, unreadByRoom],
  );

  // `withTicket` doesn't stamp `updatedAt`, so we spread it in explicitly —
  // same as the deleteCategory / moveRoom reducers in use-rooms.ts.
  const setStatus = useCallback(
    (ticketId: string, status: TicketStatus) =>
      mutate((cur, now) =>
        cur.map((n) => (n.id === ticketId ? { ...withTicket(n, { status }), updatedAt: now } : n)),
      ),
    [mutate],
  );

  const archive = useCallback((ticketId: string) => archiveNode(ticketId), [archiveNode]);

  return { tickets, loading: !ready, setStatus, archive };
}
