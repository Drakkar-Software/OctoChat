import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { layout } from '@/theme';
import type { Room } from '@/lib/types';
import { DM_HOME_ID, isDmHomeId } from '@/lib/dm-home';
import { useProfile } from '@/lib/profile-context';
import { useRoomSidebarVisible } from '@/lib/use-responsive';
import { useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useSpaceNav } from '@/lib/use-space-nav';
import { useSpaces } from '@/lib/use-spaces';
import { useDms, useTotalDmUnread } from '@/lib/use-dms';
import { useTheme } from '@/lib/use-theme';
import { useThreadDigest } from '@/lib/thread-digest-context';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

import { DesktopRoomSidebar } from './DesktopRoomSidebar';
import { DesktopSpacesRail } from './DesktopSpacesRail';

/**
 * Persistent left navigation of the desktop shell: the spaces rail + the active
 * space's room sidebar. Owns space selection and routes room/profile/search
 * presses into the main pane. Rendered once by {@link AppFrame} on wide web.
 */
export function DesktopNav() {
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string; roomId?: string }>();
  const { profile } = useProfile();
  const { session } = useSession();
  const { spaces, activeId, setActiveId, loading: spacesLoading, reorderSpaces } = useSpaces();
  const isDmHome = isDmHomeId(activeId);
  const navId = isDmHome ? null : activeId; // the virtual DM space has no registry doc
  const { categories, loading: roomsLoading, isPublic, memberCount, isOwner, createRoom, createCategory, moveRoom } =
    useRooms(navId);
  const { digest } = useThreadDigest();
  const { hasThreads, hasPins } = useSpaceNav(navId);
  const dms = useDms();
  const dmUnread = useTotalDmUnread();
  const showRoomSidebar = useRoomSidebarVisible();

  const space = isDmHome ? undefined : spaces.find((s) => s.id === activeId) ?? spaces[0];
  const activeRoomId =
    pathname.startsWith('/room/') || pathname.startsWith('/members/')
      ? params.id
      : pathname.startsWith('/thread/')
        ? params.roomId
        : undefined;
  // The Threads tab lives at /threads (the (tabs) group is unwrapped in the URL).
  // Strict equality — `startsWith` would also match `/thread/<id>` (a single thread).
  const threadsActive = pathname === '/threads';
  const pinnedActive = pathname.startsWith('/pinned');
  const automationsActive = pathname.startsWith('/automations');
  // Show the Automations destination on every public space the user could
  // interact with: the owner (so they can create the first) and any member of a
  // space that already has at least one automated room (so they can browse).
  const hasAutomations = categories.some((c) => c.rooms.some((r) => r.kind === 'automated'));
  const showAutomations = isPublic && (isOwner || hasAutomations);
  const meLabel = (profile?.name ?? '··').slice(0, 2).toUpperCase();

  // Recent threads of the open room, shown under its sidebar row. Only when the
  // published digest is for the row we're highlighting (it's cleared on leave).
  const activeRoom = activeRoomId ? categories.flatMap((c) => c.rooms).find((r) => r.id === activeRoomId) : undefined;
  // DMs live in the virtual home (no `categories`), so resolve the open DM from the
  // DM list to give `openThread` the peer name + dm kind.
  const activeDm = activeRoomId ? dms.find((d) => d.roomId === activeRoomId) : undefined;
  const activeThreads = digest && digest.roomId === activeRoomId ? digest.threads : undefined;

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });

  const openThread = (parentId: string) => {
    if (!activeRoomId) return; // only reachable while a room (the digest's) is open
    router.push({
      pathname: '/thread/[id]',
      params: {
        id: parentId,
        roomId: activeRoomId,
        roomName: activeRoom?.name ?? activeDm?.name ?? activeRoomId,
        kind: activeRoom?.kind ?? (activeDm ? 'dm' : 'channel'),
      },
    });
  };

  const selectSpace = (id: string) => {
    setActiveId(id);
    router.push('/(tabs)/rooms');
  };

  return (
    <>
      <DesktopSpacesRail
        spaces={spaces}
        activeId={activeId}
        onSelect={selectSpace}
        onSelectDms={() => { setActiveId(DM_HOME_ID); router.push('/(tabs)/rooms'); }}
        dmsActive={isDmHome}
        dmUnread={dmUnread}
        onAdd={() => router.push('/join')}
        meLabel={meLabel}
        meAvatar={profile?.avatar}
        onOpenProfile={() => router.push('/(tabs)/you')}
        onReorder={(ids) => void reorderSpaces(ids)}
      />
      {showRoomSidebar &&
        (isDmHome ? (
          <DesktopRoomSidebar
            isDmHome
            dms={dms}
            userId={session?.userId ?? ''}
            activeRoomId={activeRoomId}
            threads={activeThreads}
            onOpenRoom={openRoom}
            onOpenThread={openThread}
          />
        ) : space ? (
          <DesktopRoomSidebar
            space={space}
            isPublic={isPublic}
            memberCount={memberCount}
            categories={categories}
            userId={session?.userId ?? ''}
            activeRoomId={activeRoomId}
            threads={activeThreads}
            onOpenRoom={openRoom}
            onOpenThread={openThread}
            onOpenThreads={hasThreads ? () => router.push('/(tabs)/threads') : undefined}
            threadsActive={threadsActive}
            onOpenPinned={hasPins ? () => router.push({ pathname: '/pinned/[id]', params: { id: space.id } }) : undefined}
            pinnedActive={pinnedActive}
            onOpenAutomations={
              showAutomations
                ? () => router.push({ pathname: '/automations/[spaceId]', params: { spaceId: space.id } })
                : undefined
            }
            automationsActive={automationsActive}
            onJumpTo={() => router.push('/search')}
            onOpenSpaceMenu={() => router.push({ pathname: '/space/[id]', params: { id: space.id, name: space.name } })}
            onCreateRoom={(category, name, kind) => createRoom(name, category, kind)}
            onMoveRoom={isOwner ? moveRoom : undefined}
            onCreateCategory={isOwner ? createCategory : undefined}
            loading={roomsLoading}
          />
        ) : (
          <View style={[styles.sidebar, { width: layout.sidebarWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
            {spacesLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : (
              <EmptyState
                iconName="globe"
                title="No spaces yet"
                subtitle="Join a space with an invite to start chatting securely."
              >
                <Button label="Join a space" variant="primary" iconName="plus" full onPress={() => router.push('/join')} />
              </EmptyState>
            )}
          </View>
        ))}
    </>
  );
}

const styles = StyleSheet.create({
  sidebar: { borderRightWidth: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
