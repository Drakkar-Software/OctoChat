import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';

import type { Space } from '@/lib/types';

import { createSpace as createSpaceDoc, onSpaceMeta, readSpaces } from './starfish/registry';
import { createPublicSpace } from './starfish/pubspace';
import { useSession } from './session-context';
import { useUnread } from './unread-context';

/** The current identity's spaces (empty until the user creates or joins one). */
export function useSpaces() {
  const { session } = useSession();
  const { unreadBySpace } = useUnread();
  const pathname = usePathname();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Overlay live per-space unread totals so the space rails' Badges light up.
  const spacesWithUnread = useMemo<Space[]>(
    () => spaces.map((s) => ({ ...s, unread: unreadBySpace[s.id] ?? 0 })),
    [spaces, unreadBySpace],
  );

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

  // Adopt a freshly-saved/reconciled space name + image (from the settings screen
  // or a post-sync reconcile) live, without waiting for the next navigation refresh.
  useEffect(
    () =>
      onSpaceMeta((id, meta) => {
        setSpaces((prev) =>
          prev.map((s) => (s.id === id ? { ...s, name: meta.name, short: meta.short, image: meta.image } : s)),
        );
      }),
    [],
  );

  const createSpace = useCallback(
    async (name: string, type: 'private' | 'public' = 'private'): Promise<Space | null> => {
      if (!session) return null;
      const space =
        type === 'public'
          ? await createPublicSpace(session, name)
          : await createSpaceDoc(session.accountClient, session.userId, name);
      await refresh();
      setActiveId(space.id);
      return space;
    },
    [session, refresh],
  );

  return { spaces: spacesWithUnread, activeId, setActiveId, loading, createSpace };
}
