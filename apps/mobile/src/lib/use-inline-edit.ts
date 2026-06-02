import { useCallback, useState } from 'react';

import type { ID } from './types';

/** Single-cell "which row is being edited" state, lifted out of components so a
 *  tap-to-edit surface (doc blocks, project card/column titles) holds no editing
 *  logic in its JSX. One id is open at a time; opening another closes the first. */
export interface InlineEdit {
  editingId: ID | null;
  isEditing: (id: ID) => boolean;
  begin: (id: ID) => void;
  close: () => void;
}

export function useInlineEdit(): InlineEdit {
  const [editingId, setEditingId] = useState<ID | null>(null);
  const begin = useCallback((id: ID) => setEditingId(id), []);
  const close = useCallback(() => setEditingId(null), []);
  const isEditing = useCallback((id: ID) => editingId === id, [editingId]);
  return { editingId, isEditing, begin, close };
}
