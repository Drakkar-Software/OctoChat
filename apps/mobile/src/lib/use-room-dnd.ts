/**
 * Web drag-and-drop for moving a channel between categories. RN-Web host components
 * (`View`/`Pressable`) forward their `ref` to the underlying DOM node, so this is the
 * element-scoped cousin of {@link useFileDrop}: a draggable hook for each channel row
 * and a drop-zone hook for each category section, wired with native DOM drag events.
 *
 * Native has no DOM drag API — there a parallel `use-room-dnd.native.ts` stubs both
 * hooks to inert refs, and the long-press "Move to…" picker does the same job.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { View } from 'react-native';

/** The room id currently being dragged — read on drop as a fallback when the
 *  `dataTransfer` payload is unavailable (some browsers withhold it outside `drop`),
 *  and to gate drop-zone highlighting on a room drag (vs a file/text drag). */
let draggingRoomId: string | null = null;

const DRAG_MIME = 'text/octo-room';

/** Attach to a channel row's outer `View`/`Pressable` ref to make it draggable. */
export function useDraggableRoom(roomId: string) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    node.setAttribute('draggable', 'true');
    const onDragStart = (e: DragEvent) => {
      draggingRoomId = roomId;
      try {
        e.dataTransfer?.setData(DRAG_MIME, roomId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      } catch {
        /* dataTransfer may be locked in some browsers — the module fallback covers it */
      }
    };
    const onDragEnd = () => {
      draggingRoomId = null;
    };
    node.addEventListener('dragstart', onDragStart);
    node.addEventListener('dragend', onDragEnd);
    return () => {
      node.removeAttribute('draggable');
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('dragend', onDragEnd);
    };
  }, [roomId]);
  return ref;
}

/** Attach to a category section's outer `View` ref to accept dropped rooms.
 *  `onDropRoom` fires with the dragged room id; `onOver` toggles a drop highlight. */
export function useRoomDropZone(
  category: string,
  onDropRoom: (roomId: string) => void,
  onOver?: (over: boolean) => void,
) {
  const ref = useRef<View>(null);
  // Latest callbacks read lazily at event time so the listeners bind once per category.
  const dropRef = useRef(onDropRoom);
  dropRef.current = onDropRoom;
  const overRef = useRef(onOver);
  overRef.current = onOver;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    const onDragOver = (e: DragEvent) => {
      if (!draggingRoomId) return; // not a room drag — let other drops (files) through
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    const onDragEnter = (e: DragEvent) => {
      if (!draggingRoomId) return;
      e.preventDefault();
      overRef.current?.(true);
    };
    const onDragLeave = () => overRef.current?.(false);
    const onDrop = (e: DragEvent) => {
      const id = e.dataTransfer?.getData(DRAG_MIME) || draggingRoomId;
      overRef.current?.(false);
      draggingRoomId = null;
      if (!id) return;
      e.preventDefault();
      dropRef.current(id);
    };

    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragenter', onDragEnter);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragenter', onDragEnter);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    };
  }, [category]);

  return ref;
}
