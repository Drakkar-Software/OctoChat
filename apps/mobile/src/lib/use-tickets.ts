import { useMemo } from 'react';
import { useObjects } from './use-objects';
import { ticketOf } from '@drakkar.software/octochat-sdk';
import type { ObjectNode } from '@drakkar.software/octochat-sdk';
import type { TicketMeta } from '@drakkar.software/octochat-sdk';

export interface TicketEntry {
  node: ObjectNode;
  ticket: TicketMeta;
}

/**
 * Returns all ticket nodes in a space, projected from the unified object index.
 * Ticket rooms are ObjectNode with type === 'ticket'.
 */
export function useTickets(spaceId: string | null): { tickets: TicketEntry[]; loading: boolean } {
  const { nodes, ready } = useObjects(spaceId ?? '', { enabled: !!spaceId });

  const tickets = useMemo<TicketEntry[]>(
    () =>
      nodes
        .filter((n) => n.type === 'ticket')
        .map((n) => ({
          node: n,
          ticket: ticketOf(n) ?? { status: 'open', priority: 'medium', assigneeId: null, requester: '', slaDueAt: null },
        })),
    [nodes],
  );

  return { tickets, loading: !ready };
}
