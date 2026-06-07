import { useEffect, useMemo } from 'react';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import type { StoredMsg } from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { buildThreadDigest } from '@drakkar.software/octochat-sdk';
import { useThreadDigest } from '@/lib/thread-digest-context';
import type { MessageEditEvent } from '@drakkar.software/octochat-sdk';

// Stable empty fallback: a fresh `[]` per render would make `threads` a new
// reference every render (when the store has no messages/edits yet), re-running
// the publish effect → setDigest → re-render → loop. One shared array avoids that.
const EMPTY: never[] = [];

/**
 * Headless connector (renders nothing): reads the open room's synced message log
 * and publishes its recent-threads digest to {@link useThreadDigest}, so the
 * desktop sidebar can list the room's latest threads under its row.
 *
 * It's a component, not a hook, so the room screen can mount it ONLY once the
 * store exists — `useStarfishData` requires a non-null store and hooks can't be
 * called conditionally.
 */
export function ThreadDigestPublisher({
  store,
  roomId,
  readBefore,
}: {
  store: Parameters<typeof useStarfishData>[0];
  roomId: string;
  /** The viewer's room last-read snapshot — replies newer than it read as unread.
   *  `null` until it hydrates from kv (see room/[id].tsx); treated as "all read"
   *  (no unread badges) meanwhile, never as 0 (which would mark every reply unread). */
  readBefore: number | null;
}) {
  const { publish } = useThreadDigest();
  const { session } = useSession();
  // Read the raw selector outputs (stable store refs, or `undefined`) and only fall
  // back to EMPTY inside the memo — so the deps stay equal across renders and the
  // digest is recomputed only when the room's messages/edits actually change.
  const messages = useStarfishData(store, (d) => d.messages as StoredMsg[] | undefined);
  const edits = useStarfishData(store, (d) => d.edits as MessageEditEvent[] | undefined);
  const threads = useMemo(
    // null readBefore → use a far-future mark so nothing counts as unread yet.
    // session.userId so my own replies don't badge the thread as unread (same self-skip as notifications).
    () => buildThreadDigest(messages ?? EMPTY, edits ?? EMPTY, readBefore ?? Number.MAX_SAFE_INTEGER, session?.userId),
    [messages, edits, readBefore, session?.userId],
  );

  // Publish on every change…
  useEffect(() => {
    publish(roomId, threads);
  }, [roomId, threads, publish]);

  // …and clear when this room screen unmounts (or the room changes).
  useEffect(() => () => publish(roomId, null), [roomId, publish]);

  return null;
}
