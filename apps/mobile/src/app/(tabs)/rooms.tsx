import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import type { Room } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';
import { RoomCategorySection } from '@/components/chat/RoomCategorySection';
import { SpaceHeader } from '@/components/chat/SpaceHeader';

export default function RoomsScreen() {
  const { session } = useSession();
  const inShell = useInShell();
  const { spaces, activeId, setActiveId, loading: spacesLoading } = useSpaces();
  const { categories, loading: roomsLoading, createRoom } = useRooms(activeId);
  const space = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });

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
            onSelectSpace={setActiveId}
            onSearch={() => router.push('/(tabs)/search')}
            onMenu={() => router.push('/join')}
          />
        ) : undefined
      }
    >
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" subtitle="Create an identity to see your spaces." />
      ) : spacesLoading || roomsLoading ? (
        <EmptyState iconName="globe" title="Loading spaces…" />
      ) : categories.length === 0 ? (
        <EmptyState iconName="hash" title="No rooms yet" subtitle="Create a channel to get started." />
      ) : (
        categories.map((cat) => (
          <RoomCategorySection
            key={cat.name}
            category={cat}
            onOpenRoom={openRoom}
            onCreateRoom={(category, name) => createRoom(name, category)}
          />
        ))
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
