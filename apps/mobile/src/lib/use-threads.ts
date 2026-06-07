import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadAllThreads, type CrossRoomThread } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { useUnread } from './unread-context';

/**
 * Every thread (a parent message with ≥1 reply) across the decrypted rooms of a
 * space, newest activity first. Decrypted on-device like {@link useSearch}, but
 * re-run on screen focus (via {@link useFocusEffect}) — the Threads tab stays
 * mounted, so a one-shot load would go stale; refocusing reloads it. `lastReadAt`
 * is a stable ref-reader, so it never re-runs the decrypt on its own.
 */
export function useThreads(spaceId: string | null) {
  const { session } = useSession();
  const { lastReadAt } = useUnread();
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
          const all = await loadAllThreads(session, spaceId, lastReadAt);
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
