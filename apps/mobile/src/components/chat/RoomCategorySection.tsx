import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { Room } from '@/lib/types';
import type { RoomCategory } from '@/lib/placeholder-data';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { ChannelRow } from './ChannelRow';

interface RoomCategorySectionProps {
  category: RoomCategory;
  activeRoomId?: string;
  onOpenRoom: (room: Room) => void;
}

/** A collapsible category header followed by its room rows. */
export function RoomCategorySection({ category, activeRoomId, onOpenRoom }: RoomCategorySectionProps) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setCollapsed((c) => !c)}
        style={styles.header}
      >
        <Icon name={collapsed ? 'chev' : 'chevron-down'} size={12} color={colors.inkMuted} />
        <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
          {category.name}
        </Txt>
        <View style={styles.spacer} />
        <Icon name="plus" size={13} color={colors.inkMuted} />
      </Pressable>
      {!collapsed
        ? category.rooms.map((room) => (
            <ChannelRow
              key={room.id}
              room={room}
              active={room.id === activeRoomId}
              onPress={() => onOpenRoom(room)}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  spacer: { flex: 1 },
});
