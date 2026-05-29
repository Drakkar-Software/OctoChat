import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { layout } from '@/theme';
import type { Room } from '@/lib/types';
import { useProfile } from '@/lib/profile-context';
import { useRoomSidebarVisible } from '@/lib/use-responsive';
import { useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useSpaceNav } from '@/lib/use-space-nav';
import { useSpaces } from '@/lib/use-spaces';
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
  const { spaces, activeId, setActiveId, loading: spacesLoading } = useSpaces();
  const { categories, loading: roomsLoading, isPublic, memberCount, isOwner, createRoom, createCategory, moveRoom } =
    useRooms(activeId);
  const { digest } = useThreadDigest();
  const { hasThreads, hasPins } = useSpaceNav(activeId);
  const showRoomSidebar = useRoomSidebarVisible();

  const space = spaces.find((s) => s.id === activeId) ?? spaces[0];
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
  const meLabel = (profile?.name ?? '··').slice(0, 2).toUpperCase();

  // Recent threads of the open room, shown under its sidebar row. Only when the
  // published digest is for the row we're highlighting (it's cleared on leave).
  const activeRoom = activeRoomId ? categories.flatMap((c) => c.rooms).find((r) => r.id === activeRoomId) : undefined;
  const activeThreads = digest && digest.roomId === activeRoomId ? digest.threads : undefined;

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });

  const openThread = (parentId: string) => {
    if (!activeRoomId) return; // only reachable while a room (the digest's) is open
    router.push({
      pathname: '/thread/[id]',
      params: { id: parentId, roomId: activeRoomId, roomName: activeRoom?.name ?? activeRoomId, kind: activeRoom?.kind ?? 'channel' },
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
        onAdd={() => router.push('/join')}
        meLabel={meLabel}
        meAvatar={profile?.avatar}
        onOpenProfile={() => router.push('/(tabs)/you')}
      />
      {showRoomSidebar &&
        (space ? (
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
