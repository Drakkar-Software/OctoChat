import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { Room } from '@/lib/types';
import type { RoomCategory } from '@/lib/use-rooms';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

import { ChannelRow } from './ChannelRow';

interface RoomCategorySectionProps {
  category: RoomCategory;
  activeRoomId?: string;
  onOpenRoom: (room: Room) => void;
  /** Create a channel in this category. Resolves to an error message to show
   *  (e.g. only the owner may add channels), or `null`/void on success. Omit to
   *  hide the add control. */
  onCreateRoom?: (category: string, name: string) => Promise<string | null> | void;
}

/** A collapsible category header followed by its room rows. */
export function RoomCategorySection({ category, activeRoomId, onOpenRoom, onCreateRoom }: RoomCategorySectionProps) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    setName('');
    setAdding(false);
    if (!n) return;
    const message = await onCreateRoom?.(category.name, n);
    setError(typeof message === 'string' ? message : null);
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
              setError(null);
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
        <TextField
          leadingIcon="hash"
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          onBlur={() => {
            if (!name.trim()) setAdding(false);
          }}
          placeholder="new-channel"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          containerStyle={[styles.addField, { backgroundColor: colors.paper }]}
        />
      ) : null}

      {error ? (
        <View style={styles.notice}>
          <Callout tone="warning" iconName="lock">
            {error}
          </Callout>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md },
  addField: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
  notice: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
});
