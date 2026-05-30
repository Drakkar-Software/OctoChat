import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useOnline } from '@/lib/connectivity';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useDms, type DmEntry } from '@/lib/use-dms';
import type { Room } from '@/lib/types';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { ChannelListSkeleton } from '@/components/chat/ChannelListSkeleton';
import { DirectMessagesSection } from '@/components/chat/DirectMessagesSection';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
import { RoomCategoryList } from '@/components/chat/RoomCategoryList';
import { SidebarLinkRow } from '@/components/chat/SidebarLinkRow';
import { SpaceHeader } from '@/components/chat/SpaceHeader';

export default function RoomsScreen() {
  const { session } = useSession();
  const inShell = useInShell();
  const online = useOnline();
  const { spaces, activeId, setActiveId, loading: spacesLoading } = useSpaces();
  const { categories, loading: roomsLoading, isPublic, memberCount, isOwner, createRoom, createCategory, moveRoom } =
    useRooms(activeId);
  const space = spaces.find((s) => s.id === activeId) ?? spaces[0];
  const dms = useDms();
  // Surface the Automations destination whenever the space could carry one — to
  // owners (so they can create the first) and to members of any space that
  // already has at least one automated room (so they can browse them).
  const hasAutomations = categories.some((c) => c.rooms.some((r) => r.kind === 'automated'));
  const showAutomations = !!session && !!activeId && isPublic && (isOwner || hasAutomations);

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });
  const openDm = (dm: DmEntry) =>
    router.push({ pathname: '/room/[id]', params: { id: dm.roomId, name: dm.name, kind: 'dm' } });

  // On desktop the sidebar IS the room list, so this pane is the resting state.
  if (inShell) {
    return (
      <StackScreen inTabs>
        <EmptyState
          iconName="hash"
          title="Select a room"
          subtitle="Choose a channel or DM from the sidebar to start chatting."
        />
      </StackScreen>
    );
  }

  return (
    <StackScreen
      inTabs
      scroll
      contentStyle={styles.content}
      header={
        space ? (
          <SpaceHeader
            space={space}
            spaces={spaces}
            activeId={activeId ?? space.id}
            isPublic={isPublic}
            memberCount={memberCount}
            onSelectSpace={setActiveId}
            onAddSpace={() => router.push('/join')}
            onSearch={() => router.push('/search')}
            onOpenSpace={() => router.push({ pathname: '/space/[id]', params: { id: space.id, name: space.name } })}
            onMenu={() => router.push('/join')}
          />
        ) : (
          <AppBar
            title="Rooms"
            right={
              <>
                <IconButton
                  name="search"
                  onPress={() => router.push('/search')}
                  accessibilityLabel="Search"
                />
                <IconButton
                  name="plus"
                  onPress={() => router.push('/join')}
                  accessibilityLabel="Join or create a space"
                />
              </>
            }
          />
        )
      }
    >
      {!session ? (
        <SignInPrompt subtitle="Create an identity to see your spaces." />
      ) : spacesLoading || roomsLoading ? (
        <ChannelListSkeleton />
      ) : (
        <>
          {/* Hoisted above the empty-state so an offline user is always told WHY the
              list is sparse — even when the cache is empty and they see "No rooms yet". */}
          {!online ? <OfflineBanner message="You’re offline — showing your last-synced rooms." /> : null}
          {/* DMs are personal + cross-space, so they sit at the top of the list — above
              the active space's channels — and render whether or not this space has any. */}
          <DirectMessagesSection dms={dms} onOpen={openDm} />
          {categories.length === 0 && !isOwner ? (
            <EmptyState iconName="hash" title="No rooms yet" subtitle="Create a channel to get started." />
          ) : (
            <>
              {/* Same per-space contextual destinations as the desktop sidebar
                  (DesktopRoomSidebar): Threads is a global shortcut anchored
                  inside the active space; Automations leads to a list view that
                  also hosts the "New automation" creator. */}
              <SidebarLinkRow iconName="thread" label="Threads" onPress={() => router.push('/(tabs)/threads')} />
              {showAutomations && activeId ? (
                <SidebarLinkRow
                  iconName="refresh"
                  label="Automations"
                  onPress={() =>
                    router.push({ pathname: '/automations/[spaceId]', params: { spaceId: activeId } })
                  }
                />
              ) : null}
              <RoomCategoryList
                categories={categories}
                userId={session.userId}
                spaceId={activeId ?? space?.id ?? ''}
                onOpenRoom={openRoom}
                onCreateRoom={(category, name, kind) => createRoom(name, category, kind)}
                onMoveRoom={isOwner ? moveRoom : undefined}
                onCreateCategory={isOwner ? createCategory : undefined}
              />
            </>
          )}
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
