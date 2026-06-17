import { router } from 'expo-router';

import { useGuestRooms, type GuestRoomEntry } from '@/lib/use-guest-rooms';
import { useCategoryCollapse } from '@/lib/use-category-collapse';
import { CollapsibleSection } from '@/components/chat/CollapsibleSection';
import { ListRow } from '@/components/chat/ListRow';

// Sentinel key for the collapse state — never clashes with a real category name.
const GUEST_ROOMS_KEY = '__guest_rooms__';

interface GuestRoomSectionProps {
  /** The signed-in user id — used to scope the collapse state per identity. */
  userId: string;
}

function openGuestRoom(entry: GuestRoomEntry) {
  router.push({
    pathname: '/room/[id]',
    params: {
      id: entry.nodeId,
      name: entry.name,
      kind: 'channel',
      // Pass the owner's real space id so resolveRoomLogPaths routes to objInvLog.
      spaceId: entry.ownerSpaceId,
      access: 'invite',
      enc: entry.enc ? '1' : '0',
    },
  });
}

/**
 * Collapsible "Shared rooms" section for the REQUESTER — lists all invite-access rooms
 * (shared rooms + tickets) the user was granted without being a space member.  Shown in
 * the DM home view, next to Direct Messages.  Hidden when the requester holds no grants.
 */
export function GuestRoomSection({ userId }: GuestRoomSectionProps) {
  const rooms = useGuestRooms();
  // Use a sentinel space id so the collapse state is shared across all guest rooms
  // (there is no single "space" they belong to from the requester's perspective).
  const { isCollapsed, toggle } = useCategoryCollapse(userId, '__guest__', 'shared');

  if (rooms.length === 0) return null;

  return (
    <CollapsibleSection
      label="Shared rooms"
      count={rooms.length}
      collapsed={isCollapsed(GUEST_ROOMS_KEY)}
      onToggleCollapse={() => toggle(GUEST_ROOMS_KEY)}
    >
      {rooms.map((entry) => (
        <ListRow
          key={entry.nodeId}
          label={entry.name}
          iconName={entry.isTicket ? 'dm' : 'hash'}
          unread={entry.unread}
          onPress={() => openGuestRoom(entry)}
        />
      ))}
    </CollapsibleSection>
  );
}
