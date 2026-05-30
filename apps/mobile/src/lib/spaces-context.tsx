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
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';

import type { DmMap, Space } from '@/lib/types';

import { createSpace as createSpaceDoc, onSpaceMeta, readSpaces } from './starfish/registry';
import { isDmSpaceId, reconcileDmInbox } from './starfish/dm';
import { createPublicSpace } from './starfish/pubspace';
import { consumePrimedSpaces } from './spaces-prime';
import { hydrateMutes } from './mutes';
import { flushReadsNow, hydrateReads } from './reads';
import { useSession } from './session-context';

interface SpacesContextValue {
  /** The identity's spaces, WITHOUT the unread overlay (added in `useSpaces`). DM
   *  spaces (`dm-` prefix) are excluded — they surface in the Direct Messages section
   *  (see `useDmMap`/`use-dms`), never as a space rail. */
  spaces: Space[];
  /** Peer userId → shared DM-space id. Drives the Direct Messages section. */
  dms: DmMap;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  createSpace: (name: string, type?: 'private' | 'public') => Promise<Space | null>;
}

/** Drop DM spaces — they never belong in the space rail / switcher. */
const railSpaces = (list: Space[]): Space[] => list.filter((s) => !isDmSpaceId(s.id));

const Ctx = createContext<SpacesContextValue | null>(null);

export function SpacesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const pathname = usePathname();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [dms, setDms] = useState<DmMap>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { spaces: list, mutes, reads, dms: dmMap } = await readSpaces(session.accountClient, session.userId);
    const rail = railSpaces(list);
    setSpaces(rail);
    setDms(dmMap);
    setActiveId((prev) => prev ?? rail[0]?.id ?? null);
    // This `_spaces` re-pull runs on every navigation (effect below) and on app
    // foreground — the only post-startup re-read of the doc. Re-hydrate the read marks
    // and mute prefs from it too (they share the doc) so a room read or a space muted
    // on another device propagates here without an app restart. Max-merged / server-
    // authoritative in their own modules, so a stale read can't roll local state back.
    await hydrateReads(session.userId, reads);
    await hydrateMutes(session.userId, mutes);
    // Accept any inbound DM invites delivered through a shared space's carrier
    // (best-effort, fire-and-forget so a carrier hiccup never blocks the rails). If a
    // new DM was accepted, re-read so its peer→space mapping reaches the DM section.
    void reconcileDmInbox(session, rail)
      .then(async (changed) => {
        if (!changed) return;
        const next = await readSpaces(session.accountClient, session.userId);
        setDms(next.dms);
      })
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading spaces on session change
    setLoading(true);
    if (!session) {
      setSpaces([]);
      setDms({});
      setActiveId(null);
      setLoading(false);
      return;
    }
    // Adopt the `_spaces` doc already read during session setup (member-cap
    // hydration) instead of pulling the identical doc again on first paint. Falls
    // back to a read when no fresh stash exists (e.g. a later in-app refresh).
    const primed = consumePrimedSpaces(session.userId);
    // An EMPTY prime (`[]`) is truthy in JS — if we adopted it we'd short-circuit
    // the refresh and show a blank rail. Offline that empty came from a failed
    // `readSpaces`; the SDK pull cache now serves the last-synced `_spaces` doc on
    // the refresh below, so fall through to it instead of locking in empty.
    if (primed && primed.length > 0) {
      // Filter DM spaces out of the rail here too; the `dms` map (and DM section)
      // hydrate on the first navigation/foreground refresh.
      const rail = railSpaces(primed);
      setSpaces(rail);
      setActiveId((prev) => prev ?? rail[0]?.id ?? null);
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

  // Re-pull on app foreground too, so the read-mark / mute reconcile happens even when
  // the user returns to the app WITHOUT navigating (the navigation effect above never
  // fires then). On web a tab refocus dispatches the same 'active' change — a harmless
  // extra reconcile. Idempotent: an unchanged doc no-ops in the hydrate functions.
  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh().catch(() => {});
      } else {
        // Backgrounding is the most common "done reading" action on mobile — push any
        // read marks still inside the debounce window NOW, before RN freezes timers.
        void flushReadsNow();
      }
    });
    return () => sub.remove();
  }, [session, refresh]);

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
    () => ({ spaces, dms, activeId, setActiveId, loading, refresh, createSpace }),
    [spaces, dms, activeId, loading, refresh, createSpace],
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

/** The peer→DM-space map (see {@link SpacesContextValue.dms}) — the source for the
 *  Direct Messages section. Thin selector over the spaces context. */
export function useDmMap(): DmMap {
  return useSpacesContext().dms;
}
