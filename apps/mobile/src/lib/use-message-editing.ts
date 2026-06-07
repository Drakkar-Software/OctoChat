import { useCallback, useState } from 'react';
import type { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { lastEditableMessageId, type StoredMsg } from '@drakkar.software/octochat-sdk';
import type { MessageEditEvent } from '@drakkar.software/octochat-sdk';

type Store = Parameters<typeof useStarfishData>[0];

/**
 * Coordinates inline message editing for a room: which message (if any) has its
 * inline editor open, shared between the conversation list (which renders the
 * editor) and the composer's ArrowUp "edit my last message" shortcut.
 *
 * `editLast` reads the store's current document imperatively (no extra
 * subscription, so it tolerates a not-yet-open `null` store) — it always targets
 * the freshest message at keypress time rather than a render-time snapshot.
 */
export function useMessageEditing(store: Store | null, currentUserId: string) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editLast = useCallback(() => {
    if (!store) return;
    const data = store.getState().data;
    const id = lastEditableMessageId(
      (data.messages as StoredMsg[]) ?? [],
      (data.edits as MessageEditEvent[]) ?? [],
      currentUserId,
    );
    if (id) setEditingId(id);
  }, [store, currentUserId]);
  return { editingId, setEditingId, editLast };
}
