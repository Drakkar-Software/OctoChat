import { useEffect, useState } from 'react';

import { loadAllPins, loadAllThreads } from '@drakkar.software/octochat-sdk';
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
 * never-unmounting shell. Flags are best-effort: they refresh on space-switch, not the
 * instant someone pins/replies elsewhere (there's no space-wide reactive store).
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
          loadAllThreads(session, spaceId, lastReadAt),
          loadAllPins(session, spaceId),
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
