import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import { useOnline } from '@/lib/connectivity';
import { isDmHomeId } from '@/lib/dm-home';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useSpaceNav } from '@/lib/use-space-nav';
import { excludeAutomatedRooms, useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useDms, type DmEntry } from '@/lib/use-dms';
import { DEFAULT_CATEGORY, type Room } from '@drakkar.software/octochat-sdk';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Txt } from '@/components/ui/Txt';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { ChannelListSkeleton } from '@/components/chat/ChannelListSkeleton';
import { CreateRoomSheet } from '@/components/chat/CreateRoomSheet';
import { ChatNoSpaces } from '@/components/chat/ChatEmpty';
import { SpaceDigestCard } from '@/components/chat/SpaceDigestCard';
import { DmList } from '@/components/chat/DmList';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
import { RoomCategoryList } from '@/components/chat/RoomCategoryList';
import { SidebarLinkRow } from '@/components/chat/SidebarLinkRow';
import { SpaceTabHeader } from '@/components/chat/SpaceTabHeader';
import { useFeature } from '@/lib/use-feature';
import { TicketList } from '@/components/desk/TicketList';
import { RequestsLink } from '@/components/desk/RequestsLink';
import { SharedRoomList } from '@/components/desk/SharedRoomList';
import { GuestRoomSection } from '@/components/desk/GuestRoomSection';

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

  const hasChannels = useFeature('channels');
  const [addingRoom, setAddingRoom] = useState(false);

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });
  const openDm = (dm: DmEntry) =>
    router.push({ pathname: '/room/[id]', params: { id: dm.roomId, name: dm.name, kind: 'dm' } });

  // On desktop the sidebar IS the room list. The main pane's resting state is a
  // real home rather than a dead-end "Select a room" placeholder — it shows the
  // space name + member count, the AI unread digest (when applicable), and quick
  // access to Threads/Pinned so landing here is actually useful.
  if (inShell) {
    return (
      <StackScreen inTabs>
        <View style={styles.shellHome}>
          {isDmHome ? (
            // DM home: sidebar already shows every conversation — keep the pane calm.
            <Txt variant="footnote" tone="inkMuted" style={styles.shellHint}>
              Select a conversation from the sidebar.
            </Txt>
          ) : (
            <>
              {space ? (
                <View style={styles.shellHeader}>
                  <Txt variant="title" weight="bold" numberOfLines={1}>
                    {space.name}
                  </Txt>
                  <Txt variant="footnote" tone="inkMuted">
                    {space.members} {space.members === 1 ? 'member' : 'members'}
                  </Txt>
                </View>
              ) : null}
              {/* AI unread summary — visible when there are unreads and AI is on;
                  renders null itself when the space is caught up or AI is off. */}
              <SpaceDigestCard spaceId={activeId ?? space?.id ?? null} />
              {/* Space-wide destinations so the home is a real launch pad, not a
                  wait screen. Mirrors the sidebar nav group links. */}
              <SidebarLinkRow iconName="thread" label="Threads" onPress={() => router.push('/threads')} />
              {hasPins && activeId ? (
                <SidebarLinkRow
                  iconName="pin"
                  label="Pinned"
                  onPress={() => router.push({ pathname: '/pinned/[id]', params: { id: activeId } })}
                />
              ) : null}
              <Divider style={styles.shellDivider} />
              <Txt variant="footnote" tone="inkMuted" style={styles.shellHint}>
                Select a channel from the sidebar to start chatting.
              </Txt>
            </>
          )}
        </View>
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
      ) : !isDmHome && spaces.length === 0 ? (
        <ChatNoSpaces />
      ) : isDmHome ? (
        // EmptyState is flex:1, which collapses inside the ScrollView content container
        // — give it a floor so the no-DMs case still centers.
        <View style={styles.dmHome}>
          <DmList dms={dms} onOpen={openDm} />
          {/* Shared rooms + tickets the user was granted as a requester (no space membership). */}
          <GuestRoomSection userId={session.userId} />
        </View>
      ) : (
        <>
          {/* Hoisted above the empty-state so an offline user is always told WHY the
              list is sparse — even when the cache is empty and they see "No rooms yet". */}
          {!online ? <OfflineBanner message="You're offline — showing your last-synced rooms." /> : null}
          {categories.length > 0 ? (
            // Space has channels — show digest, nav links, and the channel list.
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
                onCreateRoom={(category, name, isPublic) => createRoom(name, category, { isPublic })}
                onMoveRoom={isOwner ? moveRoom : undefined}
                onCreateCategory={isOwner ? createCategory : undefined}
              />
            </>
          ) : hasChannels ? (
            // Channels are enabled but none created yet.
            // Owner gets a welcoming first-channel state; a non-owner is told the space is empty.
            <>
              <View style={styles.emptyFloor}>
                <EmptyState
                  iconName="hash"
                  title="No channels yet"
                  subtitle={isOwner ? 'Create your first channel to start the conversation.' : "The owner hasn't added channels yet."}
                  action={isOwner ? (
                    <Button
                      label="New channel"
                      iconName="hash"
                      variant="primary"
                      onPress={() => setAddingRoom(true)}
                    />
                  ) : undefined}
                />
              </View>
              {isOwner ? (
                <CreateRoomSheet
                  visible={addingRoom}
                  onClose={() => setAddingRoom(false)}
                  defaultCategory={DEFAULT_CATEGORY}
                  onSubmit={async (name, category, isPublic) => {
                    await createRoom(name, category, { isPublic });
                    return null;
                  }}
                />
              ) : null}
            </>
          ) : null}
          {/* Shared rooms + ticket rooms — capability-gated inside their respective lists,
              independent of channel count so OctoDesk-only spaces always render them. */}
          {(activeId ?? space?.id) ? (
            <>
              <RequestsLink spaceId={activeId ?? space?.id ?? ''} />
              <SharedRoomList spaceId={activeId ?? space?.id ?? ''} userId={session.userId} />
              <TicketList spaceId={activeId ?? space?.id ?? ''} userId={session.userId} />
            </>
          ) : null}
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: layout.tabBarSafeBottom },
  dmHome: { minHeight: layout.emptyStateFloor },
  // EmptyState is flex:1, which collapses inside a ScrollView — minHeight gives it a
  // floor so the centered icon/title/action group is visible without scrolling.
  emptyFloor: { minHeight: layout.emptyStateFloor },
  navDivider: { marginVertical: spacing.xs, marginHorizontal: spacing.xs },
  // Desktop shell home pane — a real launch pad, not a "Select a room" dead end.
  shellHome: { padding: spacing.lg, gap: spacing.md },
  shellHeader: { gap: spacing.hair, marginBottom: spacing.xs },
  shellDivider: { marginVertical: spacing.xs },
  shellHint: { textAlign: 'center', paddingVertical: spacing.md },
});

