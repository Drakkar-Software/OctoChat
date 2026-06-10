import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useOnline } from '@/lib/connectivity';
import { isDmHomeId } from '@/lib/dm-home';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useSpaceNav } from '@/lib/use-space-nav';
import { excludeAutomatedRooms, useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useDms, type DmEntry } from '@/lib/use-dms';
import type { Room } from '@drakkar.software/octochat-sdk';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { ChannelListSkeleton } from '@/components/chat/ChannelListSkeleton';
import { SpaceDigestCard } from '@/components/chat/SpaceDigestCard';
import { DmList } from '@/components/chat/DmList';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
import { RoomCategoryList } from '@/components/chat/RoomCategoryList';
import { SidebarLinkRow } from '@/components/chat/SidebarLinkRow';
import { SpaceTabHeader } from '@/components/chat/SpaceTabHeader';

/**
 * Chat bottom tab — the space's rooms, threads and pins. One of the three mode
 * tabs (Chat · Agents · Work); the in-list mode switcher it used to carry now
 * lives in the tab bar. DMs are reached via the header's space switcher (DM
 * home); Threads/Pinned via the link rows below the header.
 */
export default function RoomsScreen() {
  const { session } = useSession();
  const inShell = useInShell();
  const online = useOnline();
  const { spaces, activeId, loading: spacesLoading } = useSpaces();
  const isDmHome = isDmHomeId(activeId);
  const { categories, loading: roomsLoading, isOwner, createRoom, createCategory, moveRoom } =
    useRooms(isDmHome ? null : activeId); // the virtual DM space has no registry doc
  const space = isDmHome ? undefined : spaces.find((s) => s.id === activeId) ?? spaces[0];
  const { hasPins } = useSpaceNav(isDmHome ? null : activeId);
  const dms = useDms();

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

  // Native gets a real nav-stack header (see SpaceStackLayout) so it owns the top
  // inset; web keeps the in-screen custom header with its hide-on-scroll behavior.
  const nativeHeader = Platform.OS !== 'web';

  return (
    <StackScreen
      inTabs
      scroll
      collapsibleHeader={!nativeHeader}
      contentStyle={styles.content}
      header={nativeHeader ? undefined : <SpaceTabHeader />}
      headerProvidedNatively={nativeHeader}
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
          {categories.length === 0 ? (
            // Owner gets a welcoming first-channel state (+ the create control below);
            // a non-owner is told the space is empty rather than to "create a channel".
            <>
              <View style={styles.emptyFloor}>
                <EmptyState
                  iconName="hash"
                  title="No channels yet"
                  subtitle={isOwner ? 'Create your first channel to start the conversation.' : 'The owner hasn’t added channels yet.'}
                />
              </View>
              {isOwner ? (
                <RoomCategoryList
                  categories={[]}
                  userId={session.userId}
                  spaceId={activeId ?? space?.id ?? ''}
                  onOpenRoom={openRoom}
                  onCreateRoom={(category, name) => createRoom(name, category)}
                  onMoveRoom={moveRoom}
                  onCreateCategory={createCategory}
                />
              ) : null}
            </>
          ) : (
            <>
              {/* Threads + Pinned are space-scoped destinations; automations live in
                  the Agents tab, so automated rooms are stripped from this list. */}
              <SpaceDigestCard spaceId={activeId ?? space?.id ?? null} />
              <SidebarLinkRow iconName="thread" label="Threads" onPress={() => router.push('/threads')} />
              {hasPins && activeId ? (
                <SidebarLinkRow
                  iconName="pin"
                  label="Pinned"
                  onPress={() => router.push({ pathname: '/pinned/[id]', params: { id: activeId } })}
                />
              ) : null}
              {/* Separate the space-scoped destinations (Threads/Pinned) from the
                  channel list so views read distinctly from rooms. */}
              <Divider style={styles.navDivider} />
              <RoomCategoryList
                categories={excludeAutomatedRooms(categories)}
                userId={session.userId}
                spaceId={activeId ?? space?.id ?? ''}
                onOpenRoom={openRoom}
                onCreateRoom={(category, name) => createRoom(name, category)}
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
  // EmptyState is flex:1; give it a floor so the owner-no-rooms state centers above
  // the create control instead of collapsing in the scroll container.
  emptyFloor: { minHeight: 260 },
  navDivider: { marginVertical: spacing.xs, marginHorizontal: spacing.xs },
});
