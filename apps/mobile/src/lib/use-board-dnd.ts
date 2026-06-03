/**
 * Web drag-and-drop for a kanban board — reorder a task within its column and move
 * it across columns. The element-scoped cousin of {@link useRoomDropZone}: RN-Web
 * forwards a `View` ref to its DOM node, so each card is a native draggable and each
 * column is a drop zone that resolves the insertion index from the pointer's `clientY`
 * against the cards' rects (one zone per column — nesting per-card zones flickers as
 * HTML5 drag events bubble across children).
 *
 * Native has no DOM drag API; `use-board-dnd.native.ts` stubs both hooks to inert refs
 * (touch reorder would use a long-press affordance, not built here).
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { View } from 'react-native';

/** The task id currently being dragged — read on drop as a fallback when `dataTransfer`
 *  is withheld outside the `drop` event, and to gate drop highlighting on a task drag. */
let draggingTaskId: string | null = null;

const DRAG_MIME = 'text/octo-task';
/** DOM attribute (RN-Web `dataSet.taskId`) a card carries so a column can locate it. */
export const TASK_DATA_ATTR = 'data-task-id';

/** Attach to a card's outer `View` ref to make it draggable. The `data-task-id` marker
 *  is set unconditionally (so a column can locate every card when resolving a drop);
 *  `enabled` is false while the card is in its inline-edit state, so only the drag
 *  itself is suspended (text selection isn't hijacked) without dropping it from the
 *  position math. */
export function useDraggableTask(taskId: string, enabled = true) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.setAttribute !== 'function') return;
    node.setAttribute(TASK_DATA_ATTR, taskId);
    if (!enabled) return () => node.removeAttribute(TASK_DATA_ATTR);

    node.setAttribute('draggable', 'true');
    const onDragStart = (e: DragEvent) => {
      draggingTaskId = taskId;
      try {
        e.dataTransfer?.setData(DRAG_MIME, taskId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      } catch {
        /* dataTransfer may be locked in some browsers — the module fallback covers it */
      }
    };
    const onDragEnd = () => {
      draggingTaskId = null;
    };
    node.addEventListener('dragstart', onDragStart);
    node.addEventListener('dragend', onDragEnd);
    return () => {
      node.removeAttribute(TASK_DATA_ATTR);
      node.removeAttribute('draggable');
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('dragend', onDragEnd);
    };
  }, [taskId, enabled]);
  return ref;
}

export interface ColumnDrop {
  /** Attach to the column's cards container `View`. */
  ref: React.RefObject<View | null>;
  /** Insertion index the pointer currently maps to (counting the rendered cards, so it
   *  aligns with the column's task list as drawn), or null when no task is hovering.
   *  Drives the insert line. */
  overIndex: number | null;
}

/**
 * Make a column accept dropped task cards. `onDrop(taskId, index)` fires with the
 * dragged task and the resolved insertion index among the column's rendered cards; the
 * pure {@link orderForInsert} normalizes for the dragged card's own slot. The hook
 * tracks `overIndex` for the caller to render an insert indicator.
 */
export function useColumnDrop(onDrop: (taskId: string, index: number) => void): ColumnDrop {
  const ref = useRef<View>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    // Insertion index = first card whose vertical midpoint is below the pointer, counting
    // all rendered cards (incl. the dragged one) so it aligns with the drawn list; the
    // dragged card's own slot is normalized away later by orderForInsert.
    const indexAt = (clientY: number): number => {
      const cards = node.querySelectorAll<HTMLElement>(`[${TASK_DATA_ATTR}]`);
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i]!.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return i;
      }
      return cards.length;
    };

    const onDragOver = (e: DragEvent) => {
      if (!draggingTaskId) return; // not a task drag — let other drops through
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      setOverIndex(indexAt(e.clientY));
    };
    const onDragLeave = (e: DragEvent) => {
      // dragleave also fires crossing into child cards; only clear when truly leaving.
      if (!node.contains(e.relatedTarget as Node | null)) setOverIndex(null);
    };
    const onDropEvent = (e: DragEvent) => {
      const id = e.dataTransfer?.getData(DRAG_MIME) || draggingTaskId;
      const index = indexAt(e.clientY);
      setOverIndex(null);
      draggingTaskId = null;
      if (!id) return;
      e.preventDefault();
      dropRef.current(id, index);
    };

    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDropEvent);
    return () => {
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDropEvent);
    };
  }, []);

  return { ref, overIndex };
}
