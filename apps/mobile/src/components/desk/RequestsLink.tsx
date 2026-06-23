import { router } from 'expo-router';

import { useFeature } from '@/lib/use-feature';
import { useRequestsCount } from '@/lib/requests-context';
import { SidebarLinkRow } from '@/components/chat/SidebarLinkRow';

/**
 * Sidebar entry for pending ticket/room requests. Renders nothing when there are
 * no pending requests (or when the `tickets` capability is off), so OctoDesk-free
 * spaces aren't cluttered with a dead row. Shows the pending count as an unread
 * badge so the owner notices new requests at a glance. Tapping opens `/requests`,
 * which lists the full queue with Accept / Decline per row.
 *
 * Replaces the old `RequestsShelf` (inline collapsed list in the sidebar).
 */
export function RequestsLink({ spaceId }: { spaceId: string }) {
  const hasTickets = useFeature('tickets');
  const count = useRequestsCount(spaceId);

  if (!hasTickets || count === 0) return null;

  return (
    <SidebarLinkRow
      iconName="clock"
      label="Requests"
      unread={count}
      onPress={() => router.push('/requests')}
    />
  );
}
