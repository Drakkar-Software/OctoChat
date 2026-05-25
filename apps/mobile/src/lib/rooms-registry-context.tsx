/**
 * App-wide owner of every space's `_rooms` registry, mounted once near the root.
 * Before this, each consumer of a space's registry — the desktop nav, the routed
 * rooms page, the Composer's #channel resolver, every ActivityFeed section, AND the
 * room screen's own owner-check — called `readRooms` independently, so the same doc
 * was pulled several times per load (a global request-dedupe hack used to paper over
 * it). This provider reads each space's registry ONCE and shares it: display
 * consumers subscribe via {@link useRoomsRegistry}; the room opener awaits {@link
 * RoomsRegistryActions.ensure} imperatively. Both hit the same cache and the same
 * in-flight read.
 *
 * It sits BELOW SpacesProvider (it reads the known-spaces snapshot for
 * `reconcileSpaceMeta`'s fast path) and ABOVE UnreadProvider (the live unread
 * overlay is applied in the `useRooms` consumer, not here).
 *
 * Freshness: a registry is read once per space per session and then cached. Owner
 * edits made on THIS device refresh it immediately (see `useRooms.createRoom` →
 * `refresh`); a channel added on ANOTHER device shows up on the next app load (or
 * account switch), which is an acceptable trade for not re-pulling the registry on
 * every navigation. The shared space name/image still propagates live via
 * `reconcileSpaceMeta`'s broadcast into SpacesProvider.
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

import type { Room } from '@/lib/types';

import { readRooms, reconcileSpaceMeta } from './starfish/registry';
import {
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  readPublicRoomsDoc,
} from './starfish/pubspace';
import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';

export interface RoomsRegistryEntry {
  rooms: Room[];
  owner: string | null;
  members: string[];
  name: string | null;
  image: string | null;
  hash: string | null;
  /** A read is in progress (true until the first read settles). */
  loading: boolean;
  /** A read has settled at least once — distinguishes "empty" from "not read yet". */
  loaded: boolean;
}

const PENDING: RoomsRegistryEntry = {
  rooms: [], owner: null, members: [], name: null, image: null, hash: null, loading: true, loaded: false,
};
const IDLE: RoomsRegistryEntry = { ...PENDING, loading: false };

/** Imperative side of the registry, for the room opener (`useRoom`). */
interface RoomsRegistryActions {
  /** Current snapshot for a space (PENDING until its first read settles). */
  get: (spaceId: string) => RoomsRegistryEntry;
  /** Read a space's registry once (shared in-flight + cache); resolve its entry. */
  ensure: (spaceId: string) => Promise<RoomsRegistryEntry>;
  /** Force a fresh read (after an owner write). */
  refresh: (spaceId: string) => Promise<RoomsRegistryEntry>;
  /** Subscribe a consumer to a space (triggers `ensure`); returns an unsubscribe. */
  subscribe: (spaceId: string, cb: () => void) => () => void;
}

const Ctx = createContext<RoomsRegistryActions | null>(null);

export function RoomsRegistryProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { spaces } = useSpacesContext();
  const userId = session?.userId ?? null;

  // Provider-instance state held in refs so an entry update re-renders only the
  // consumers of THAT space (via its listener set), not the whole provider tree.
  const entries = useRef(new Map<string, RoomsRegistryEntry>());
  const inflight = useRef(new Map<string, Promise<RoomsRegistryEntry>>());
  const listeners = useRef(new Map<string, Set<() => void>>());
  const refCounts = useRef(new Map<string, number>());

  // Latest session/spaces, read by the stable `fetchEntry` below so `ensure`'s
  // identity never churns (which would re-run every consumer's subscribe effect).
  // Synced after render — writing a ref during render trips react-hooks/refs.
  const sessionRef = useRef(session);
  const spacesRef = useRef(spaces);
  useEffect(() => {
    sessionRef.current = session;
    spacesRef.current = spaces;
  });

  const notify = useCallback((spaceId: string) => {
    const set = listeners.current.get(spaceId);
    if (set) for (const cb of set) cb();
  }, []);

  const get = useCallback((spaceId: string) => entries.current.get(spaceId) ?? PENDING, []);

  // The actual read, branched by space type — mirrors the old `useRooms.refresh`,
  // including the best-effort `reconcileSpaceMeta` that folds the shared name/image
  // into this identity's `_spaces` cache (skipped fast when already in sync).
  const fetchEntry = useCallback(async (spaceId: string): Promise<RoomsRegistryEntry> => {
    const s = sessionRef.current;
    if (!s) return IDLE;
    if (isPublicSpaceId(spaceId)) {
      const auth = publicSpaceAuth(s, spaceId);
      const { rooms, name, image } = await readPublicRoomsDoc(publicSpaceClient(s, spaceId), auth.ownerId, spaceId);
      void reconcileSpaceMeta(s.accountClient, s.userId, spaceId, { name, image }, spacesRef.current).catch(() => {});
      return { rooms, owner: auth.ownerId, members: [], name, image, hash: null, loading: false, loaded: true };
    }
    const { rooms, owner, members, name, image, hash } = await readRooms(s.accountClient, spaceId);
    void reconcileSpaceMeta(s.accountClient, s.userId, spaceId, { name, image }, spacesRef.current).catch(() => {});
    return { rooms, owner, members, name, image, hash, loading: false, loaded: true };
  }, []);

  // Run one read for a space, sharing the in-flight promise and publishing the
  // result (or an empty-but-loaded entry on failure, mirroring readRooms' degrade).
  const runFetch = useCallback((spaceId: string): Promise<RoomsRegistryEntry> => {
    const pending = inflight.current.get(spaceId);
    if (pending) return pending;
    const prev = entries.current.get(spaceId) ?? PENDING;
    entries.current.set(spaceId, { ...prev, loading: true });
    notify(spaceId);
    const p = fetchEntry(spaceId)
      .catch(() => ({ ...IDLE, loaded: true }))
      .then((entry) => {
        entries.current.set(spaceId, entry);
        return entry;
      })
      .finally(() => {
        inflight.current.delete(spaceId);
        notify(spaceId);
      });
    inflight.current.set(spaceId, p);
    return p;
  }, [fetchEntry, notify]);

  const ensure = useCallback((spaceId: string): Promise<RoomsRegistryEntry> => {
    const cached = entries.current.get(spaceId);
    if (cached?.loaded) return Promise.resolve(cached);
    return runFetch(spaceId);
  }, [runFetch]);

  const refresh = useCallback((spaceId: string): Promise<RoomsRegistryEntry> => {
    entries.current.delete(spaceId); // force a re-read even if already loaded
    return runFetch(spaceId);
  }, [runFetch]);

  const subscribe = useCallback((spaceId: string, cb: () => void) => {
    let set = listeners.current.get(spaceId);
    if (!set) {
      set = new Set();
      listeners.current.set(spaceId, set);
    }
    set.add(cb);
    refCounts.current.set(spaceId, (refCounts.current.get(spaceId) ?? 0) + 1);
    void ensure(spaceId);
    return () => {
      set!.delete(cb);
      const n = (refCounts.current.get(spaceId) ?? 1) - 1;
      if (n > 0) {
        refCounts.current.set(spaceId, n);
        return;
      }
      // Last consumer of this space left: drop its cached registry so re-entry reads
      // fresh (picking up channels an owner may have added elsewhere meanwhile).
      refCounts.current.delete(spaceId);
      entries.current.delete(spaceId);
      listeners.current.delete(spaceId);
    };
  }, [ensure]);

  // New identity (or sign-out): drop every cached registry so nothing bleeds across
  // accounts, and flip current consumers back to PENDING. We do NOT re-read here —
  // the still-subscribed spaceIds belong to the OLD account (a different account can't
  // read them). Fresh reads are driven by consumers' own subscribe effects, which
  // re-run as `activeId` switches to the new identity's spaces (SpacesProvider reloads
  // on the session change). Old-account entries stay PENDING until their consumers
  // unmount (refCount → 0 → evicted).
  useEffect(() => {
    entries.current.clear();
    inflight.current.clear();
    for (const spaceId of listeners.current.keys()) notify(spaceId);
  }, [userId, notify]);

  const value = useMemo<RoomsRegistryActions>(
    () => ({ get, ensure, refresh, subscribe }),
    [get, ensure, refresh, subscribe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useRegistryActions(): RoomsRegistryActions {
  const v = useContext(Ctx);
  if (!v) throw new Error('Rooms registry hooks must be used within RoomsRegistryProvider');
  return v;
}

/** Imperative registry access for the room opener — `ensure`/`refresh`/`get`. */
export function useRoomsRegistryActions(): RoomsRegistryActions {
  return useRegistryActions();
}

/** Reactive read of a space's registry: subscribes (triggering a one-time read) and
 *  re-renders as it loads/refreshes. `null` spaceId yields an idle, empty entry. */
export function useRoomsRegistry(spaceId: string | null): RoomsRegistryEntry {
  const actions = useRegistryActions();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!spaceId) return;
    return actions.subscribe(spaceId, () => tick((n) => n + 1));
  }, [actions, spaceId]);
  return spaceId ? actions.get(spaceId) : IDLE;
}
