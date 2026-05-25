/**
 * App-wide space registry, mounted once near the root. Before this, every
 * `useSpaces()` caller (desktop nav, the routed page, the activity feed, …) was a
 * standalone hook with its own state and its own `_spaces` fetch — so the same
 * registry was pulled many times per load, and `activeId` drifted per instance.
 * This provider holds ONE copy; `useSpaces` is now a thin consumer over it.
 *
 * It deliberately does NOT depend on unread state: `UnreadProvider` reads the
 * space-id set from here, so the provider must sit ABOVE it in the tree. The live
 * unread overlay is applied in `useSpaces`, the consumer side.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'expo-router';

import type { Space } from '@/lib/types';

import { createSpace as createSpaceDoc, onSpaceMeta, readSpaces } from './starfish/registry';
import { createPublicSpace } from './starfish/pubspace';
import { consumePrimedSpaces } from './spaces-prime';
import { useSession } from './session-context';

interface SpacesContextValue {
  /** The identity's spaces, WITHOUT the unread overlay (added in `useSpaces`). */
  spaces: Space[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  createSpace: (name: string, type?: 'private' | 'public') => Promise<Space | null>;
}

const Ctx = createContext<SpacesContextValue | null>(null);

export function SpacesProvider({ children }: { children: ReactNode }) {
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading spaces on session change
    setLoading(true);
    if (!session) {
      setSpaces([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    // Adopt the `_spaces` doc already read during session setup (member-cap
    // hydration) instead of pulling the identical doc again on first paint. Falls
    // back to a read when no fresh stash exists (e.g. a later in-app refresh).
    const primed = consumePrimedSpaces(session.userId);
    if (primed) {
      setSpaces(primed);
      setActiveId((prev) => prev ?? primed[0]?.id ?? null);
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

  // Re-read on navigation (no loading flicker) so a space created on another
  // device shows up in the persistent desktop shell, which never remounts. One
  // refresh for the whole app now, not one per mounted consumer. Skips the mount
  // run (the effect above already loads then) so first paint is a single fetch.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!session) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
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

  const value = useMemo<SpacesContextValue>(
    () => ({ spaces, activeId, setActiveId, loading, refresh, createSpace }),
    [spaces, activeId, loading, refresh, createSpace],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Raw spaces context (no unread overlay). Most UI should use `useSpaces` instead;
 *  this is for the unread provider, which must not depend on unread state. */
export function useSpacesContext(): SpacesContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSpacesContext must be used within SpacesProvider');
  return v;
}
