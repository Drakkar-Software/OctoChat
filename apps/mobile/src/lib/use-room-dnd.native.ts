/**
 * Native stub for the web drag-and-drop hooks (see `use-room-dnd.ts`). There is no
 * DOM drag API on iOS/Android, so both hooks return an inert ref and do nothing — the
 * long-press "Move to…" picker handles re-homing a channel on touch platforms.
 */
import { useRef } from 'react';
import type { View } from 'react-native';

export function useDraggableRoom(_roomId: string) {
  return useRef<View>(null);
}

export function useRoomDropZone(
  _category: string,
  _onDropRoom: (roomId: string) => void,
  _onOver?: (over: boolean) => void,
) {
  return useRef<View>(null);
}
