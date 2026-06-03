/**
 * Native stub for the web kanban drag-and-drop hooks (see `use-board-dnd.ts`). iOS/
 * Android have no DOM drag API, so both hooks return inert refs and never fire — the
 * board stays tap-driven on touch platforms.
 */
import { useRef } from 'react';
import type { View } from 'react-native';

import type { ColumnDrop } from './use-board-dnd';

export const TASK_DATA_ATTR = 'data-task-id';

export function useDraggableTask(_taskId: string, _enabled = true) {
  return useRef<View>(null);
}

export function useColumnDrop(_onDrop: (taskId: string, index: number) => void): ColumnDrop {
  return { ref: useRef<View>(null), overIndex: null };
}
