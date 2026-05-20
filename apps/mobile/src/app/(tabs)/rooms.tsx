import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { ACTIVE_SPACE_ID, SPACES, getRoomsByCategory, getSpace } from '@/lib/placeholder-data';
import type { Room } from '@/lib/types';
import { StackScreen } from '@/components/ui/StackScreen';
import { RoomCategorySection } from '@/components/chat/RoomCategorySection';
import { SpaceHeader } from '@/components/chat/SpaceHeader';

export default function RoomsScreen() {
  const space = getSpace(ACTIVE_SPACE_ID);
  const sections = getRoomsByCategory();

  const openRoom = (room: Room) => router.push({ pathname: '/room/[id]', params: { id: room.id } });

  return (
    <StackScreen
      inTabs
      scroll
      contentStyle={styles.content}
      header={
        <SpaceHeader
          space={space}
          spaces={SPACES}
          activeId={ACTIVE_SPACE_ID}
          onSearch={() => router.push('/(tabs)/search')}
        />
      }
    >
      {sections.map((cat) => (
        <RoomCategorySection key={cat.name} category={cat} onOpenRoom={openRoom} />
      ))}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
