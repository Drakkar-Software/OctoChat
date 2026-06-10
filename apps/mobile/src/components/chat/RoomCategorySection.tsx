import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Room } from '@drakkar.software/octochat-sdk';
import type { ThreadSummary } from '@drakkar.software/octochat-sdk';
import type { RoomCategory } from '@/lib/use-rooms';
import { useRoomDropZone } from '@/lib/use-room-dnd';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

import { DraggableChannelRow } from './DraggableChannelRow';
import { ThreadRow } from './ThreadRow';

interface RoomCategorySectionProps {
  category: RoomCategory;
  activeRoomId?: string;
  /** Recent threads of the active room — rendered indented under its row. */
  threads?: ThreadSummary[];
  /** Whether this category is collapsed (controlled — persisted by the parent). */
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenRoom: (room: Room) => void;
  /** Open one of the active room's threads (the reply target's message id). */
  onOpenThread?: (parentId: string) => void;
  /** Create a room in this category. Every room is the same append-only kind now, so
   *  there's no type to choose. Resolves to an error message to show (e.g. only the owner
   *  may add rooms), or `null`/void on success. Omit to hide the add control. */
  onCreateRoom?: (category: string, name: string) => Promise<string | null> | void;
  /** Owner-only: a room was dropped onto this category (web drag) — re-home it here. */
  onMoveRoom?: (roomId: string) => void;
  /** Owner-only: request moving a room via the picker (native long-press). */
  onRequestMove?: (room: Room) => void;
}

/** A collapsible category header followed by its room rows. The active room's
 *  row is trailed by its most recent threads (when supplied). Doubles as a
 *  drop target so a channel dragged onto it (web) re-homes into this category. */
export function RoomCategorySection({
  category,
  activeRoomId,
  threads,
  collapsed,
  onToggleCollapse,
  onOpenRoom,
  onOpenThread,
  onCreateRoom,
  onMoveRoom,
  onRequestMove,
}: RoomCategorySectionProps) {
  const { colors } = useTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState(false);

  // Web drag-drop target (no-op on native). The dropped room re-homes into this
  // category; `dropOver` paints a highlight while a row hovers over the section.
  const dropRef = useRoomDropZone(category.name, (roomId) => onMoveRoom?.(roomId), setDropOver);

  const submit = async () => {
    const n = name.trim();
    setName('');
    setAdding(false);
    if (!n) return;
    const message = await onCreateRoom?.(category.name, n);
    setError(typeof message === 'string' ? message : null);
  };

  return (
    <View
      ref={dropRef}
      style={[
        styles.section,
        // A quiet lit-from-above top divider separates one shelf from the next so
        // categories read as distinct groups without adding chrome. The drag-over
        // state still wins, washing the whole section in accent.
        { borderTopColor: colors.ruleSoft },
        dropOver ? { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder, borderTopColor: colors.accentBorder } : null,
      ]}
    >
      {/* Collapse toggle and the add button are separate press targets so the
          "+" stays comfortably clickable and never just folds the category. */}
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onToggleCollapse} style={styles.toggle}>
          <Icon name={collapsed ? 'chev' : 'chevron-down'} size={12} color={colors.inkMuted} />
          <Txt variant="caption" weight="bold" mono uppercase tone="inkMuted" numberOfLines={1} style={styles.label}>
            {category.name}
          </Txt>
          {/* A faint room count so even a collapsed shelf communicates its size. */}
          {category.rooms.length ? (
            <Txt variant="caption" mono tone="inkFaint">
              {category.rooms.length}
            </Txt>
          ) : null}
        </Pressable>
        {onCreateRoom ? (
          <IconButton
            name={adding ? 'x' : 'plus'}
            size={14}
            color={colors.inkMuted}
            accessibilityLabel={adding ? 'Cancel new room' : `Add a room to ${category.name}`}
            onPress={() => {
              setError(null);
              if (collapsed) onToggleCollapse(); // expand so the add box is visible
              setAdding((a) => !a);
            }}
          />
        ) : null}
      </View>

      {!collapsed
        ? category.rooms.map((room) => (
            <Fragment key={room.id}>
              <DraggableChannelRow
                room={room}
                active={room.id === activeRoomId}
                onPress={() => onOpenRoom(room)}
                onRequestMove={onRequestMove}
              />
              {room.id === activeRoomId && threads?.length
                ? threads.map((t) => (
                    <ThreadRow key={t.parentId} thread={t} onPress={() => onOpenThread?.(t.parentId)} />
                  ))
                : null}
            </Fragment>
          ))
        : null}

      {!collapsed && adding ? (
        <View style={styles.addBox}>
          {/* Every room is the same append-only kind now — just name it (no type to pick). */}
          <TextField
            leadingIcon="hash"
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            onKeyPress={(e) => {
              // Escape cancels the add box (web). The header +/× toggle also closes it;
              // we deliberately DON'T close on blur — that fired on every internal click
              // (field icon, padding) and dismissed the box mid-interaction.
              if (e.nativeEvent.key === 'Escape') setAdding(false);
            }}
            placeholder="new-channel"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            containerStyle={[styles.addField, { backgroundColor: colors.paper }]}
          />
        </View>
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
  // A shelf: a lit top hairline + a touch of breathing room above it groups each
  // category's rows. The 1px frame stays (transparent at rest) so the drag-over
  // accent border has somewhere to paint without shifting layout.
  section: {
    marginBottom: spacing.sm,
    paddingTop: spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radii.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 6, paddingHorizontal: spacing.md },
  label: { flex: 1 },
  addBox: { marginTop: spacing.xs },
  addField: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
  notice: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
});
