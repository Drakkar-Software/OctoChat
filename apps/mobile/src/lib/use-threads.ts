import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadAllThreadsFromCache, type CrossRoomThread } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { useUnreadActions } from './unread-context';

/**
 * Every thread (a parent message with ≥1 reply) across the rooms of a space,
 * newest activity first, re-run on screen focus (via {@link useFocusEffect}) —
 * the Threads tab stays mounted, so a one-shot load would go stale; refocusing
 * reloads it. `lastReadAt` is a stable ref-reader, so it never re-runs on its own.
 *
 * CACHE-ONLY: {@link loadAllThreadsFromCache} never pulls — it folds whatever's
 * already persisted locally (written by `useRoom` on its own, already-lazy per-room
 * visits), same tradeoff as `useSpaceNav`'s sidebar flags. A room never opened on
 * this device contributes no threads until visited once; opening a thread from this
 * list only fetches that one room (`useRoom`), never the whole space.
 */
export function useThreads(spaceId: string | null) {
  const { session } = useSession();
  const { lastReadAt } = useUnreadActions();
  const [threads, setThreads] = useState<CrossRoomThread[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session || !spaceId) {
        setThreads([]);
        setLoading(false);
        return;
      }
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const all = await loadAllThreadsFromCache(session, spaceId, lastReadAt);
          if (!cancelled) setThreads(all);
        } catch {
          if (!cancelled) setThreads([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session, spaceId, lastReadAt]),
  );

  return { threads, loading };
}
