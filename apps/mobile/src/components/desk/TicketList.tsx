import { useState } from 'react';
import { router } from 'expo-router';
import { useTickets } from '@/lib/use-tickets';
import { useFeature } from '@/lib/use-feature';
import { useCategoryCollapse } from '@/lib/use-category-collapse';
import { CollapsibleSection } from '@/components/chat/CollapsibleSection';
import { TicketRow } from './TicketRow';
import { TicketActionsSheet } from './TicketActionsSheet';
import type { TicketEntry } from '@/lib/use-tickets';

// Stable key used to store the collapsed state of the Tickets shelf — it is
// intentionally not a real category name so it can never clash with user categories.
const TICKETS_KEY = '__tickets__';

interface TicketListProps {
  spaceId: string;
  userId: string;
}

/** Magic collapsible "Tickets" shelf — rendered identically to a channel category
 *  but non-deletable by construction (not a real ObjectNode category). Self-gates
 *  on the 'tickets' capability and hides when the space has no ticket rooms. */
export function TicketList({ spaceId, userId }: TicketListProps) {
  const hasTickets = useFeature('tickets');
  const { tickets, setStatus, archive } = useTickets(hasTickets ? spaceId : null);
  const { isCollapsed, toggle } = useCategoryCollapse(userId, spaceId, 'tickets');
  const [sheetEntry, setSheetEntry] = useState<TicketEntry | null>(null);

  if (!hasTickets || tickets.length === 0) return null;

  const openTicket = (entry: TicketEntry) => {
    router.push({
      pathname: '/room/[id]',
      // A ticket id (`ticket-<hex>`) carries no space segment, and tickets live outside the
      // rooms registry — so the room screen can't recover the space or the access tier on its
      // own. Pass them explicitly: `spaceId` (this shelf already knows it), the node's `access`
      // ('invite') and `enc`. `entry.title` is the display title (placeholder for E2EE tickets).
      params: {
        id: entry.node.id,
        name: entry.title,
        kind: 'channel',
        spaceId,
        access: entry.node.access,
        enc: entry.node.enc ? '1' : '0',
      },
    });
  };

  return (
    <>
      <CollapsibleSection
        label="Tickets"
        count={tickets.length}
        collapsed={isCollapsed(TICKETS_KEY)}
        onToggleCollapse={() => toggle(TICKETS_KEY)}
      >
        {tickets.map((entry) => (
          <TicketRow key={entry.node.id} entry={entry} onPress={openTicket} onLongPress={setSheetEntry} />
        ))}
      </CollapsibleSection>
      <TicketActionsSheet
        visible={sheetEntry !== null}
        entry={sheetEntry}
        onSetStatus={(s) => setStatus(sheetEntry!.node.id, s)}
        onArchive={() => archive(sheetEntry!.node.id)}
        onClose={() => setSheetEntry(null)}
      />
    </>
  );
}
