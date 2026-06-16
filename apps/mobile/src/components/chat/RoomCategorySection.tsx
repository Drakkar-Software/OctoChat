import { Fragment, useState } from 'react';
import type { Room } from '@drakkar.software/octochat-sdk';
import type { ThreadSummary } from '@drakkar.software/octochat-sdk';
import type { RoomCategory } from '@/lib/use-rooms';
import { useRoomDropZone } from '@/lib/use-room-dnd';
import { useTheme } from '@/lib/use-theme';
import { IconButton } from '@/components/ui/IconButton';

import { CollapsibleSection } from './CollapsibleSection';
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
    <>
      <CollapsibleSection
        containerRef={dropRef}
        style={dropOver ? { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder, borderTopColor: colors.accentBorder } : null}
        label={category.name}
        count={category.rooms.length || undefined}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        headerTrailing={
          onCreateRoom ? (
            <IconButton
              name="plus"
              size={14}
              color={colors.inkMuted}
              accessibilityLabel={`Add a room to ${category.name}`}
              onPress={() => setAdding(true)}
            />
          ) : null
        }
      >
        {category.rooms.map((room) => (
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
        ))}
      </CollapsibleSection>

      <CreateRoomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        defaultCategory={category.name}
        onSubmit={async (name, cat, isPublic) => await onCreateRoom?.(cat, name, isPublic) ?? null}
      />
    </>
  );
}

