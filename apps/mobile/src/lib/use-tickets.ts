import { useCallback, useMemo } from 'react';
import { useObjects } from './use-objects';
import { useUnread } from './unread-context';
import { ticketOf, withTicket } from '@drakkar.software/octochat-sdk';
import type { ObjectNode } from '@drakkar.software/octochat-sdk';
import type { TicketMeta, TicketStatus } from '@drakkar.software/octochat-sdk';

/** Shown for an E2EE ticket in the all-member list — the real subject/requester are sealed
 *  in the per-node stream and only visible to participants once the ticket is opened. */
export const ENCRYPTED_TICKET_TITLE = '🔒 Encrypted ticket';

export interface TicketEntry {
  node: ObjectNode;
  ticket: TicketMeta;
  /** Display subject: plaintext tickets show the real title; E2EE tickets show a placeholder
   *  (the sealed title is recovered on open via `readSealedTicketInfo`). */
  title: string;
  /** Display requester: empty/placeholder for E2EE tickets (sealed). */
  requester: string;
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
        .map((n) => {
          const ticket = ticketOf(n) ?? { status: 'open', priority: 'medium', assigneeId: null, requester: '', title: '', slaDueAt: null };
          // E2EE tickets strip title/requester from the index — show a placeholder in the
          // list; participants see the real values on open (decrypted from the stream).
          const title = n.enc ? ENCRYPTED_TICKET_TITLE : (ticket.title || n.title || 'Untitled ticket');
          const requester = n.enc ? '' : ticket.requester;
          return { node: n, ticket, title, requester, unread: unreadByRoom[n.id] ?? 0 };
        }),
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
