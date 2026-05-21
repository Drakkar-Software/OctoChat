import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'expo-router';

import type { Space } from '@/lib/types';

import { createSpace as createSpaceDoc, readSpaces } from './starfish/registry';
import { useSession } from './session-context';

/** The current identity's spaces (empty until the user creates or joins one). */
export function useSpaces() {
  const { session } = useSession();
  const pathname = usePathname();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { spaces: list } = await readSpaces(session.accountClient, session.userId);
    setSpaces(list);
    setActiveId((prev) => prev ?? list[0]?.id ?? null);
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

  // Re-read on navigation (no loading flicker) so a space created elsewhere shows
  // up in the persistent desktop shell, which never remounts across routes.
  useEffect(() => {
    if (!session) return;
    void refresh().catch(() => {});
  }, [pathname, session, refresh]);

  const createSpace = useCallback(
    async (name: string): Promise<Space | null> => {
      if (!session) return null;
      const space = await createSpaceDoc(session.accountClient, session.userId, name);
      await refresh();
      setActiveId(space.id);
      return space;
    },
    [session, refresh],
  );

  return { spaces, activeId, setActiveId, loading, createSpace };
}
