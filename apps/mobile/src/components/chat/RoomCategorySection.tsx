import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Room } from '@drakkar.software/octochat-sdk';
import type { ThreadSummary } from '@drakkar.software/octochat-sdk';
import type { RoomCategory } from '@/lib/use-rooms';
import { useRoomDropZone } from '@/lib/use-room-dnd';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { CreateRoomSheet } from './CreateRoomSheet';
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
  /** Create a room in this category. Pass `isPublic` to make it world-readable (plaintext);
   *  omit or pass false for a private E2EE room (default). Resolves to an error message to
   *  show (e.g. only the owner may add rooms), or `null`/void on success. Omit to hide the
   *  add control. */
  onCreateRoom?: (category: string, name: string, isPublic?: boolean) => Promise<string | null> | void;
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
  const [dropOver, setDropOver] = useState(false);

  // Web drag-drop target (no-op on native). The dropped room re-homes into this
  // category; `dropOver` paints a highlight while a row hovers over the section.
  const dropRef = useRoomDropZone(category.name, (roomId) => onMoveRoom?.(roomId), setDropOver);

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
            name="plus"
            size={14}
            color={colors.inkMuted}
            accessibilityLabel={`Add a room to ${category.name}`}
            onPress={() => setAdding(true)}
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

      <CreateRoomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        defaultCategory={category.name}
        onSubmit={(name, cat, isPublic) => onCreateRoom?.(cat, name, isPublic)}
      />
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
});
