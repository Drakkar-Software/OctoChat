import type { Room } from '@/lib/types';
import { useDraggableRoom } from '@/lib/use-room-dnd';

import { ChannelRow } from './ChannelRow';

interface DraggableChannelRowProps {
  room: Room;
  active?: boolean;
  onPress?: () => void;
  /** Owner-only: request moving this room to another category — wired to the native
   *  long-press picker. Web re-homes via drag-and-drop instead (see useDraggableRoom),
   *  so the long-press is harmless there. Omitted for non-owners (no move affordance). */
  onRequestMove?: (room: Room) => void;
}

/** {@link ChannelRow} with move affordances: a web drag handle (no-op on native) and,
 *  when `onRequestMove` is supplied, a long-press that opens the "Move to…" picker.
 *  A wrapper because the drag hook can't be called inside the category `.map`. */
export function DraggableChannelRow({ room, active, onPress, onRequestMove }: DraggableChannelRowProps) {
  const dragRef = useDraggableRoom(room.id);
  return (
    <ChannelRow
      room={room}
      active={active}
      onPress={onPress}
      rowRef={dragRef}
      onLongPress={onRequestMove ? () => onRequestMove(room) : undefined}
    />
  );
}
