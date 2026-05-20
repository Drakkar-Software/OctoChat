import { useCallback, useEffect, useState } from 'react';

import type { Space } from '@/lib/types';

import { ensureDefaults, readSpaces } from './starfish/registry';
import { useSession } from './session-context';

/** The current identity's spaces (seeds a default space on first run). */
export function useSpaces() {
  const { session } = useSession();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const seeded = await ensureDefaults(session.accountClient, session.userId);
    const { spaces: list } = await readSpaces(session.accountClient, session.userId);
    setSpaces(list);
    setActiveId((prev) => prev ?? seeded.id);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!session) {
      setSpaces([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await refresh();
      } catch {
        /* leave empty on error */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, refresh]);

  return { spaces, activeId, setActiveId, loading };
}
