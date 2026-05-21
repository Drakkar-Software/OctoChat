import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import type { Room } from '@/lib/types';
import { useProfile } from '@/lib/use-profile';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

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
  const { categories, loading: roomsLoading, createRoom } = useRooms(activeId);

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
        meLabel={meLabel}
        onOpenProfile={() => router.push('/(tabs)/you')}
      />
      {space ? (
        <DesktopRoomSidebar
          space={space}
          categories={categories}
          activeRoomId={activeRoomId}
          onOpenRoom={openRoom}
          onJumpTo={() => router.push('/(tabs)/search')}
          onOpenSpaceMenu={() => router.push('/join')}
          onCreateRoom={(category, name) => createRoom(name, category)}
          loading={roomsLoading}
        />
      ) : (
        <View style={[styles.placeholder, { width: layout.sidebarWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
          <Txt variant="footnote" tone="inkMuted">
            {spacesLoading ? 'Loading spaces…' : 'No spaces yet'}
          </Txt>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  placeholder: { borderRightWidth: 1, padding: spacing.md },
});
