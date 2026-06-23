import { ListRow } from '@/components/chat/ListRow';
import { StatusPill } from './StatusPill';
import type { TicketEntry } from '@/lib/use-tickets';

interface TicketRowProps {
  entry: TicketEntry;
  onPress: (entry: TicketEntry) => void;
  onLongPress?: (entry: TicketEntry) => void;
}

/** A single row in the ticket list sidebar section — mirrors the visual style of
 *  {@link ListRow} channel rows (same spacing, leading icon, label, badge). */
export function TicketRow({ entry, onPress, onLongPress }: TicketRowProps) {
  const { ticket, title, unread } = entry;
  return (
    <ListRow
      label={title}
      iconName="lock"
      unread={unread}
      trailing={<StatusPill status={ticket.status} />}
      onPress={() => onPress(entry)}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
    />
  );
}
