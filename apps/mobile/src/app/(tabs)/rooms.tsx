import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useOnline } from '@/lib/connectivity';
import { DM_HOME_ID, isDmHomeId } from '@/lib/dm-home';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useDms, useTotalDmUnread, type DmEntry } from '@/lib/use-dms';
import type { Room } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { ChannelListSkeleton } from '@/components/chat/ChannelListSkeleton';
import { DmList } from '@/components/chat/DmList';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
import { RoomCategoryList } from '@/components/chat/RoomCategoryList';
import { SidebarLinkRow } from '@/components/chat/SidebarLinkRow';
import { SpaceHeader } from '@/components/chat/SpaceHeader';

export default function RoomsScreen() {
  const { session } = useSession();
  const inShell = useInShell();
  const online = useOnline();
  const { spaces, activeId, setActiveId, loading: spacesLoading } = useSpaces();
  const isDmHome = isDmHomeId(activeId);
  const { categories, loading: roomsLoading, isPublic, memberCount, isOwner, createRoom, createCategory, moveRoom } =
    useRooms(isDmHome ? null : activeId); // the virtual DM space has no registry doc
  const space = isDmHome ? undefined : spaces.find((s) => s.id === activeId) ?? spaces[0];
  const dms = useDms();
  const dmUnread = useTotalDmUnread();
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
        // The DM space is always present (it's virtual), so the header always renders
        // — `space` is undefined when DM-home is selected. The rail + DM tile live here.
        <SpaceHeader
          space={space}
          isDmHome={isDmHome}
          spaces={spaces}
          activeId={activeId ?? DM_HOME_ID}
          isPublic={isPublic}
          memberCount={memberCount}
          onSelectSpace={setActiveId}
          onSelectDms={() => setActiveId(DM_HOME_ID)}
          dmsActive={isDmHome}
          dmUnread={dmUnread}
          onAddSpace={() => router.push('/join')}
          onSearch={() => router.push('/search')}
          onOpenSpace={() => space && router.push({ pathname: '/space/[id]', params: { id: space.id, name: space.name } })}
          onMenu={() => router.push('/join')}
        />
      }
    >
      {!session ? (
        <SignInPrompt subtitle="Create an identity to see your spaces." />
      ) : spacesLoading || (!isDmHome && roomsLoading) ? (
        <ChannelListSkeleton />
      ) : isDmHome ? (
        // EmptyState is flex:1, which collapses inside the ScrollView content container
        // — give it a floor so the no-DMs case still centers.
        <View style={styles.dmHome}>
          <DmList dms={dms} onOpen={openDm} />
        </View>
      ) : (
        <>
          {/* Hoisted above the empty-state so an offline user is always told WHY the
              list is sparse — even when the cache is empty and they see "No rooms yet". */}
          {!online ? <OfflineBanner message="You’re offline — showing your last-synced rooms." /> : null}
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
  dmHome: { minHeight: 320 },
});
