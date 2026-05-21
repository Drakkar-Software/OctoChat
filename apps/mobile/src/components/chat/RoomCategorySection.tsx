import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import type { Room } from '@/lib/types';
import type { RoomCategory } from '@/lib/use-rooms';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { ChannelRow } from './ChannelRow';

interface RoomCategorySectionProps {
  category: RoomCategory;
  activeRoomId?: string;
  onOpenRoom: (room: Room) => void;
  /** Create a channel in this category. Omit to hide the add control. */
  onCreateRoom?: (category: string, name: string) => void;
}

/** A collapsible category header followed by its room rows. */
export function RoomCategorySection({ category, activeRoomId, onOpenRoom, onCreateRoom }: RoomCategorySectionProps) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    const n = name.trim();
    if (n) onCreateRoom?.(category.name, n);
    setName('');
    setAdding(false);
  };

  return (
    <View style={styles.section}>
      {/* Collapse toggle and the add button are separate press targets so the
          "+" stays comfortably clickable and never just folds the category. */}
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => setCollapsed((c) => !c)} style={styles.toggle}>
          <Icon name={collapsed ? 'chev' : 'chevron-down'} size={12} color={colors.inkMuted} />
          <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
            {category.name}
          </Txt>
        </Pressable>
        {onCreateRoom ? (
          <IconButton
            name={adding ? 'x' : 'plus'}
            size={14}
            color={colors.inkMuted}
            accessibilityLabel={adding ? 'Cancel new channel' : `Add a channel to ${category.name}`}
            onPress={() => {
              setCollapsed(false);
              setAdding((a) => !a);
            }}
          />
        ) : null}
      </View>

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

      {!collapsed && adding ? (
        <View style={[styles.addRow, { backgroundColor: colors.paper, borderColor: colors.lineSoft }]}>
          <Icon name="hash" size={15} color={colors.inkMuted} />
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            onBlur={() => {
              if (!name.trim()) setAdding(false);
            }}
            placeholder="new-channel"
            placeholderTextColor={colors.inkMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            style={[styles.input, { color: colors.ink }]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: typeScale.subhead.fontSize,
    padding: 0,
    includeFontPadding: false,
  },
});
