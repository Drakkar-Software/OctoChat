import { router } from 'expo-router';

import { useFeature } from '@/lib/use-feature';
import { useCategoryCollapse } from '@/lib/use-category-collapse';
import { useSharedRooms, type SharedRoomEntry } from '@/lib/use-shared-rooms';
import { CollapsibleSection } from '@/components/chat/CollapsibleSection';
import { ListRow } from '@/components/chat/ListRow';

// Stable key for the collapse state — never clashes with a real category name.
const SHARED_ROOMS_KEY = '__shared_rooms__';

interface SharedRoomListProps {
  spaceId: string;
  userId: string;
}

/**
 * Collapsible "Shared rooms" shelf for the OWNER — rooms created in response to
 * inbound room requests (`nodeType:'room'`).  Mirrors {@link TicketList} but for
 * `type:'room' access:'invite'` nodes.  Self-gates on the `tickets` capability and
 * hides when the space has no shared rooms.
 */
export function SharedRoomList({ spaceId, userId }: SharedRoomListProps) {
  const hasTickets = useFeature('tickets');
  const { rooms } = useSharedRooms(hasTickets ? spaceId : null);
  const { isCollapsed, toggle } = useCategoryCollapse(userId, spaceId, 'shared-rooms');

  if (!hasTickets || rooms.length === 0) return null;

  const openRoom = (entry: SharedRoomEntry) => {
    router.push({
      pathname: '/room/[id]',
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
    <CollapsibleSection
      label="Shared rooms"
      count={rooms.length}
      collapsed={isCollapsed(SHARED_ROOMS_KEY)}
      onToggleCollapse={() => toggle(SHARED_ROOMS_KEY)}
    >
      {rooms.map((entry) => (
        <ListRow
          key={entry.node.id}
          label={entry.title}
          iconName="hash"
          unread={entry.unread}
          onPress={() => openRoom(entry)}
        />
      ))}
    </CollapsibleSection>
  );
}
