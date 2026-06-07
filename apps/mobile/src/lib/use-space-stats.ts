import { useEffect, useState } from 'react';

import { useSession } from './session-context';
import { loadSpaceStats, type SpaceStats } from '@drakkar.software/octochat-sdk';

/**
 * Compute a space's size + content stats once when the screen opens. `enabled` is
 * the owner gate so the per-room fan-out (see {@link loadSpaceStats}) never runs
 * for non-owners. Recomputes when the space changes; it's a snapshot, not live.
 */
export function useSpaceStats(spaceId: string, enabled: boolean): { stats: SpaceStats | null; loading: boolean } {
  const { session } = useSession();
  const [stats, setStats] = useState<SpaceStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session || !enabled) {
      setStats(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show the spinner while the per-room fan-out runs
    setLoading(true);
    setStats(null);
    (async () => {
      try {
        const s = await loadSpaceStats(session, spaceId);
        if (!cancelled) setStats(s);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, spaceId, enabled]);

  return { stats, loading };
}
