/**
 * Web drag-and-drop for reordering the spaces rail. Each space tile is both a drag
 * source and a drop target: dragging tile A onto tile B moves A to B's slot. This is
 * the rail-reorder cousin of {@link useDraggableRoom} (which re-homes a channel into a
 * category) — same native DOM-drag plumbing on the RN-Web host node, a distinct MIME
 * so the two live drags on the same screen never cross-fire.
 *
 * Native has no DOM drag API — `use-space-reorder.native.ts` stubs the hook to an inert
 * ref. The persisted order still applies on every surface (it reorders the source
 * array); only the drag affordance is web.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { View } from 'react-native';

/** The space id currently being dragged — read on drop as a fallback when the
 *  `dataTransfer` payload is withheld, and to gate drop highlighting on a space drag
 *  (vs a room/file/text drag sharing the same screen). */
let draggingSpaceId: string | null = null;

const DRAG_MIME = 'text/octo-space';

/**
 * Move `dragged` to `target`'s slot in `ids`, returning a NEW ordered id array.
 * Dropping forward inserts after the target, backward inserts before — so a tile
 * always lands where the cursor released, the least-surprising behavior. A no-op
 * (same id, or either id absent) returns the input array unchanged by reference.
 */
export function reorderBy(ids: string[], dragged: string, target: string): string[] {
  if (dragged === target) return ids;
  const from = ids.indexOf(dragged);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(next.indexOf(target) + (to > from ? 1 : 0), 0, dragged);
  return next;
}

/**
 * Attach the returned ref to a space tile's outer `View`/`Pressable` to make it both
 * draggable and a drop target. `onDrop` fires with the dragged tile's id when another
 * tile is released over this one; `onOver` toggles a drop highlight while a space drag
 * hovers. Both run only on web; native returns an inert ref.
 */
export function useReorderableSpace(
  spaceId: string,
  onDrop: (draggedId: string) => void,
  onOver?: (over: boolean) => void,
) {
  const ref = useRef<View>(null);
  // Latest callbacks read lazily at event time so the listeners bind once per tile.
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const overRef = useRef(onOver);
  overRef.current = onOver;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    node.setAttribute('draggable', 'true');

    const onDragStart = (e: DragEvent) => {
      draggingSpaceId = spaceId;
      try {
        e.dataTransfer?.setData(DRAG_MIME, spaceId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      } catch {
        /* dataTransfer may be locked in some browsers — the module fallback covers it */
      }
    };
    const onDragEnd = () => {
      draggingSpaceId = null;
      overRef.current?.(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (!draggingSpaceId) return; // not a space drag — let room/file drops through
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    const onDragEnter = (e: DragEvent) => {
      if (!draggingSpaceId || draggingSpaceId === spaceId) return;
      e.preventDefault();
      overRef.current?.(true);
    };
    const onDragLeave = () => overRef.current?.(false);
    const onDropEvt = (e: DragEvent) => {
      const id = e.dataTransfer?.getData(DRAG_MIME) || draggingSpaceId;
      overRef.current?.(false);
      draggingSpaceId = null;
      if (!id || id === spaceId) return;
      e.preventDefault();
      dropRef.current(id);
    };

    node.addEventListener('dragstart', onDragStart);
    node.addEventListener('dragend', onDragEnd);
    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragenter', onDragEnter);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDropEvt);
    return () => {
      node.removeAttribute('draggable');
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('dragend', onDragEnd);
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragenter', onDragEnter);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDropEvt);
    };
  }, [spaceId]);

  return ref;
}
