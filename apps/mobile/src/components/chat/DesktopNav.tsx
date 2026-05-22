import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { layout } from '@/theme';
import type { Room } from '@/lib/types';
import { useProfile } from '@/lib/use-profile';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useTheme } from '@/lib/use-theme';
import { useUnread } from '@/lib/unread-context';
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
  const { spaces, activeId, setActiveId, loading: spacesLoading } = useSpaces();
  const { categories, loading: roomsLoading, isPublic, memberCount, createRoom } = useRooms(activeId);
  const { totalUnread } = useUnread();

  const space = spaces.find((s) => s.id === activeId) ?? spaces[0];
  const activeRoomId =
    pathname.startsWith('/room/') || pathname.startsWith('/members/')
      ? params.id
      : pathname.startsWith('/thread')
        ? params.roomId
        : undefined;
  const meLabel = (profile?.name ?? '··').slice(0, 2).toUpperCase();

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });

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
        unread={totalUnread}
        onOpenActivity={() => router.push('/(tabs)/activity')}
        meLabel={meLabel}
        meAvatar={profile?.avatar}
        onOpenProfile={() => router.push('/(tabs)/you')}
      />
      {space ? (
        <DesktopRoomSidebar
          space={space}
          isPublic={isPublic}
          memberCount={memberCount}
          categories={categories}
          activeRoomId={activeRoomId}
          onOpenRoom={openRoom}
          onJumpTo={() => router.push('/(tabs)/search')}
          onOpenSpaceMenu={() => router.push({ pathname: '/space/[id]', params: { id: space.id, name: space.name } })}
          onCreateRoom={(category, name) => createRoom(name, category)}
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
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sidebar: { borderRightWidth: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
