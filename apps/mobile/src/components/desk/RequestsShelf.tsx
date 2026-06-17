import { useCategoryCollapse } from '@/lib/use-category-collapse';
import { useFeature } from '@/lib/use-feature';
import { usePendingRequests } from '@/lib/use-pending-requests';
import { CollapsibleSection } from '@/components/chat/CollapsibleSection';
import { RequestRow } from './RequestRow';

// Stable collapse key for the Requests shelf — intentionally not a real category name so it
// can never clash with a user category (mirrors TicketList's TICKETS_KEY).
const REQUESTS_KEY = '__requests__';

/**
 * The "Requests" shelf — pending inbound ticket requests awaiting the owner's decision, shown
 * above the Tickets shelf. Self-gates on the `tickets` capability and hides entirely when there
 * are none (auto-accept / auto-reply spaces never accumulate any; a non-owner's own inbox holds
 * none for this space). Accepting promotes a request into the Tickets shelf.
 */
export function RequestsShelf({ spaceId, userId }: { spaceId: string; userId: string }) {
  const hasTickets = useFeature('tickets');
  const { pending, count, busyId, accept, decline } = usePendingRequests(hasTickets && spaceId ? spaceId : null);
  const { isCollapsed, toggle } = useCategoryCollapse(userId, spaceId, 'requests');

  if (!hasTickets || count === 0) return null;

  return (
    <CollapsibleSection
      label="Requests"
      count={count}
      collapsed={isCollapsed(REQUESTS_KEY)}
      onToggleCollapse={() => toggle(REQUESTS_KEY)}
    >
      {pending.map((p) => (
        <RequestRow
          key={p.req.reqId}
          entry={p}
          busy={busyId === p.req.reqId}
          onAccept={() => void accept(p)}
          onDecline={() => void decline(p)}
        />
      ))}
    </CollapsibleSection>
  );
}
