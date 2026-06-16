import { useMemo } from 'react';
import { useObjects } from './use-objects';
import { useUnread } from './unread-context';
import { ticketOf } from '@drakkar.software/octochat-sdk';
import type { ObjectNode } from '@drakkar.software/octochat-sdk';
import type { TicketMeta } from '@drakkar.software/octochat-sdk';

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
 */
export function useTickets(spaceId: string | null): { tickets: TicketEntry[]; loading: boolean } {
  const { nodes, ready } = useObjects(spaceId ?? '', { enabled: !!spaceId });
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

  return { tickets, loading: !ready };
}
