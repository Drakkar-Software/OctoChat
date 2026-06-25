import type { TicketStatus } from '@drakkar.software/octochat-sdk';

import type { TicketEntry } from '@/lib/use-tickets';
import { useTheme } from '@/lib/use-theme';
import { ActionSheet } from '@/components/ui/ActionSheet';
import { Icon } from '@/components/ui/Icon';
import { StatusPill } from './StatusPill';

const STATUSES: TicketStatus[] = ['open', 'pending', 'solved', 'closed'];

interface TicketActionsSheetProps {
  visible: boolean;
  /** The ticket being acted on (null when the sheet is closed). */
  entry: TicketEntry | null;
  onSetStatus: (status: TicketStatus) => void;
  onArchive: () => void;
  onClose: () => void;
}

/**
 * Bottom-sheet action menu for a single ticket, opened via long-press on a
 * {@link TicketRow} or the header button in the ticket's room view. Offers a
 * full status picker (Open / Pending / Solved / Closed, current one check-marked)
 * and an Archive action. Built on {@link ActionSheet}.
 */
export function TicketActionsSheet({ visible, entry, onSetStatus, onArchive, onClose }: TicketActionsSheetProps) {
  const { colors } = useTheme();
  if (!entry) return null;

  const statusActions = STATUSES.map((s) => ({
    label: '',
    leadingNode: <StatusPill status={s} />,
    trailing: entry.ticket.status === s ? <Icon name="check" size={15} color={colors.inkMuted} /> : undefined,
    onPress: () => onSetStatus(s),
  }));

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={entry.node.title}
      actions={[
        ...statusActions,
        {
          label: 'Archive ticket',
          iconName: 'archive' as const,
          tone: 'danger' as const,
          onPress: onArchive,
        },
      ]}
    />
  );
}
