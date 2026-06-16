import { Pill } from '@/components/ui/Pill';
import type { TicketStatus } from '@drakkar.software/octochat-sdk';

interface StatusPillProps {
  status: TicketStatus;
}

const STATUS_TONE: Record<TicketStatus, 'neutral' | 'accent' | 'success' | 'danger' | 'note'> = {
  open: 'accent',
  pending: 'note',
  solved: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  solved: 'Solved',
  closed: 'Closed',
};

/** A small pill showing a ticket's status with the appropriate semantic tone. */
export function StatusPill({ status }: StatusPillProps) {
  return <Pill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
}
