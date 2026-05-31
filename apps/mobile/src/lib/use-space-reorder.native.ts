/**
 * Native stub for the web spaces-rail reorder hook (see `use-space-reorder.ts`). There
 * is no DOM drag API on iOS/Android, so the hook returns an inert ref. `reorderBy` is
 * pure (no DOM), so it's duplicated verbatim rather than re-exported — Metro resolves a
 * bare `./use-space-reorder` to THIS native file, so a re-export would be circular.
 */
import { useRef } from 'react';
import type { View } from 'react-native';

/** Move `dragged` to `target`'s slot in `ids` — see the web file for the contract. */
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

export function useReorderableSpace(
  _spaceId: string,
  _onDrop: (draggedId: string) => void,
  _onOver?: (over: boolean) => void,
) {
  return useRef<View>(null);
}
