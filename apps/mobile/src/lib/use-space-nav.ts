import { useEffect, useState } from 'react';

import { loadAllPinsFromCache, loadAllThreadsFromCache } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { useUnreadActions } from './unread-context';

/**
 * Existence flags for the desktop sidebar's non-room nav rows: whether the active
 * space has any threads / any pinned messages, so those rows can be hidden when empty.
 *
 * Uses a plain `useEffect` — NOT `useFocusEffect` like {@link useThreads}/{@link usePins}.
 * The sidebar ({@link DesktopNav}) is mounted by `AppFrame` as a sibling of the navigator
 * (outside it), so `useFocusEffect` → `useNavigation()` has no navigation object and would
 * throw. Loading on space-switch (the `spaceId` dep) is also the right lifecycle for a
 * never-unmounting shell.
 *
 * CACHE-ONLY: `loadAllThreadsFromCache`/`loadAllPinsFromCache` never pull — they fold
 * whatever's already persisted locally (written by `useRoom`/`useThreads`/`usePins` on
 * their own, already-lazy visits). A space this device has never touched shows both
 * flags as empty until the user actually opens a room/Threads/Pins once; every switch
 * thereafter reflects what's on disk. This trades perfect accuracy for ZERO network
 * cost on every space switch — deliberately: a full per-room log fold here previously
 * fired for every room in the space on every switch, which does not scale.
 */
export function useSpaceNav(spaceId: string | null) {
  const { session } = useSession();
  const { lastReadAt } = useUnreadActions();
  const [hasThreads, setHasThreads] = useState(false);
  const [hasPins, setHasPins] = useState(false);

  useEffect(() => {
    // Clear immediately on switch so B's sidebar never briefly shows A's flags.
    setHasThreads(false);
    setHasPins(false);
    if (!session || !spaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const [threads, pins] = await Promise.all([
          loadAllThreadsFromCache(session, spaceId, lastReadAt),
          loadAllPinsFromCache(session, spaceId),
        ]);
        if (!cancelled) {
          setHasThreads(threads.length > 0);
          setHasPins(pins.length > 0);
        }
      } catch {
        /* leave both false */
      }
    })();
    return () => {
      cancelled = true;
    };
    // lastReadAt is a stable ref-reader (mirrors useThreads) — not a re-run trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, spaceId]);

  return { hasThreads, hasPins };
}
