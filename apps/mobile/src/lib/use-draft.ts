/**
 * Local draft persistence for the composer: the message a user has typed but not
 * yet sent survives a refresh, an app restart, and leaving/re-entering the room.
 *
 * The draft is the composer's text only — pending attachments aren't persisted
 * (they're large binary blobs and re-attaching is cheap). Storage goes through
 * the cross-platform `kv` layer (localStorage on web, AsyncStorage on native) and
 * is keyed per identity so two accounts on the same device never see each other's
 * drafts, mirroring `unread-context`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { kvGet, kvRemove, kvSet } from './starfish/kv';

/** Storage key for a room's main-composer draft, scoped to the viewer. */
export const roomDraftKey = (userId: string, roomId: string) => `octochat.draft.${userId}.${roomId}`;

/** Storage key for a thread reply draft (distinct from the room's main draft). */
export const threadDraftKey = (userId: string, roomId: string, parentId: string) =>
  `octochat.draft.${userId}.${roomId}:thread:${parentId}`;

/**
 * Composer text state with optional local persistence. When `storageKey` is set
 * the last-typed text is hydrated on mount and written on every change; with no
 * key it degrades to plain `useState` (no persistence — e.g. signed out).
 *
 * `clearDraft` wipes both the in-memory text and the stored copy and is called
 * AFTER a successful send (a failed send keeps the text, so the user doesn't lose
 * their message on a network blip).
 */
export function useDraft(storageKey: string | undefined) {
  const [text, setText] = useState('');
  // The key whose stored value we've loaded. Until hydration completes, the
  // pre-hydration empty text must NOT persist over a stored draft, so the write
  // effect below is gated on this matching the current key.
  const hydratedKey = useRef<string | undefined>(undefined);

  // Hydrate the stored draft when the key becomes available / changes. Only fill
  // an untouched (still-empty) composer so a fast typist isn't clobbered by the
  // async load resolving after their first keystroke.
  useEffect(() => {
    if (!storageKey) {
      hydratedKey.current = undefined;
      return;
    }
    let cancelled = false;
    void kvGet(storageKey).then((stored) => {
      if (cancelled) return;
      hydratedKey.current = storageKey;
      if (stored) setText((cur) => (cur === '' ? stored : cur));
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Persist on every change once hydrated. localStorage/AsyncStorage writes are
  // cheap for short chat text, so there's no debounce — which also means nothing
  // is lost if the user navigates away immediately after typing.
  useEffect(() => {
    if (!storageKey || hydratedKey.current !== storageKey) return;
    if (text) void kvSet(storageKey, text);
    else void kvRemove(storageKey);
  }, [text, storageKey]);

  const clearDraft = useCallback(() => {
    setText('');
    if (storageKey) void kvRemove(storageKey);
  }, [storageKey]);

  return { text, setText, clearDraft };
}
