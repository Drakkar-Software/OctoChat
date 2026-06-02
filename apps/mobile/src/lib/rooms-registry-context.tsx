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
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { AutomationMeta, Room } from '@/lib/types';

import { kvGet, kvSet } from './starfish/kv';
import { readRooms, reconcileSpaceMeta } from './starfish/registry';
import { getSpaceEncryptor } from './starfish/space-encryptor';
import { readIndexRooms } from './starfish/object-index';
import { objIndexPull, pubObjIndexPull } from './starfish/paths';
import {
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  readPublicRoomsDoc,
} from './starfish/pubspace';
import type { Session } from './starfish/identity';
import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';

/** Private-space index read: open the (cached) space encryptor, then {@link readIndexRooms}.
 *  Skipped when the owner is unknown (unreadable/legacy registry): `getSpaceEncryptor`
 *  treats a null owner as self and could MINT a keyring as a side effect of this passive
 *  read — so we only attempt the index read once the access record names an owner. */
async function readPrivateIndexRooms(s: Session, spaceId: string, owner: string | null, members: string[]): Promise<{ rooms: Room[]; categories: string[] } | null> {
  if (owner === null) return null;
  try {
    const { encryptor, client } = await getSpaceEncryptor(spaceId, s, { owner, members });
    return await readIndexRooms(client, encryptor, objIndexPull(spaceId), spaceId);
  } catch {
    return null; // not a recipient yet / unreachable → legacy fallback
  }
}

export interface RoomsRegistryEntry {
  rooms: Room[];
  owner: string | null;
  members: string[];
  name: string | null;
  image: string | null;
  /** Ordered category list (stored, or derived from rooms — see normalizeCategories). */
  categories: string[];
  hash: string | null;
  /** A read is in progress (true until the first read settles). */
  loading: boolean;
  /** A read has settled at least once — distinguishes "empty" from "not read yet". */
  loaded: boolean;
}

const PENDING: RoomsRegistryEntry = {
  rooms: [], owner: null, members: [], name: null, image: null, categories: [], hash: null, loading: true, loaded: false,
};
const IDLE: RoomsRegistryEntry = { ...PENDING, loading: false };

// Offline cache of the plaintext `_rooms` registry (same sensitivity as the drafts /
// outbox already in kv). Lets an offline read fall back to the last-synced rooms
// instead of wiping the list. Keyed by identity so it never bleeds across accounts.
const cacheKey = (userId: string, spaceId: string) => `octochat.rooms-cache.${userId}.${spaceId}`;

/** Persist the DISPLAYABLE registry fields — never the `hash` (a cached hash must
 *  never feed a write; this cache is display-only). Fire-and-forget. */
function persistEntry(userId: string, spaceId: string, entry: RoomsRegistryEntry): void {
  const { rooms, owner, members, name, image, categories } = entry;
  void kvSet(cacheKey(userId, spaceId), JSON.stringify({ rooms, owner, members, name, image, categories })).catch(
    () => {},
  );
}

/** Load a previously-persisted entry (display-only → `hash: null`, `loaded: true`). */
async function loadCachedEntry(userId: string, spaceId: string): Promise<RoomsRegistryEntry | null> {
  try {
    const raw = await kvGet(cacheKey(userId, spaceId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<RoomsRegistryEntry>;
    return {
      rooms: Array.isArray(d.rooms) ? d.rooms : [],
      owner: typeof d.owner === 'string' ? d.owner : null,
      members: Array.isArray(d.members) ? d.members.filter((m): m is string => typeof m === 'string') : [],
      name: typeof d.name === 'string' ? d.name : null,
      image: typeof d.image === 'string' ? d.image : null,
      categories: Array.isArray(d.categories) ? d.categories.filter((c): c is string => typeof c === 'string') : [],
      hash: null,
      loading: false,
      loaded: true,
    };
  } catch {
    return null;
  }
}

/** Imperative side of the registry, for the room opener (`useRoom`). */
interface RoomsRegistryActions {
  /** Current snapshot for a space (PENDING until its first read settles). */
  get: (spaceId: string) => RoomsRegistryEntry;
  /** Read a space's registry once (shared in-flight + cache); resolve its entry. */
  ensure: (spaceId: string) => Promise<RoomsRegistryEntry>;
  /** Force a fresh read (after an owner write). */
  refresh: (spaceId: string) => Promise<RoomsRegistryEntry>;
  /** Optimistically merge a patch into a cached room's `automation` meta and
   *  notify subscribers. In-memory only — the server write already happened in
   *  `runAutomationTick`; this keeps the live cache from re-firing a just-run tick. */
  patchRoomAutomationLocal: (spaceId: string, roomId: string, patch: Partial<AutomationMeta>) => void;
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
      const legacy = await readPublicRoomsDoc(publicSpaceClient(s, spaceId), auth.ownerId, spaceId);
      void reconcileSpaceMeta(s.accountClient, s.userId, spaceId, { name: legacy.name, image: legacy.image }, spacesRef.current).catch(() => {});
      // Prefer the unified index (public spaces store it plaintext — no encryptor);
      // fall back to the legacy public `_rooms` list while unmigrated.
      const idx = await readIndexRooms(publicSpaceClient(s, spaceId), null, pubObjIndexPull(auth.ownerId, spaceId), spaceId);
      return {
        rooms: idx?.rooms ?? legacy.rooms,
        owner: auth.ownerId,
        members: [],
        name: legacy.name,
        image: legacy.image,
        categories: idx?.categories ?? legacy.categories,
        hash: null,
        loading: false,
        loaded: true,
      };
    }
    const { owner, members, name, image, hash } = await readRooms(s.accountClient, spaceId);
    void reconcileSpaceMeta(s.accountClient, s.userId, spaceId, { name, image }, spacesRef.current).catch(() => {});
    // The encrypted object index is the SOLE source of the room/category list now that
    // `_rooms` is just the access record. A failed/empty index read yields an empty list
    // (the keyring not being open yet is the only transient case, and it resolves on the
    // next read once the space is opened) rather than the old legacy `_rooms` fallback.
    const idx = await readPrivateIndexRooms(s, spaceId, owner, members);
    return { rooms: idx?.rooms ?? [], owner, members, name, image, categories: idx?.categories ?? [], hash, loading: false, loaded: true };
  }, []);

  // Run one read for a space, sharing the in-flight promise and publishing the
  // result. A FAILED read (offline / unreachable — readRooms now throws rather than
  // collapsing to empty) never wipes a known-good list: it keeps the in-memory entry,
  // else the persisted cache, else degrades to an empty-but-loaded shell.
  const runFetch = useCallback((spaceId: string): Promise<RoomsRegistryEntry> => {
    const pending = inflight.current.get(spaceId);
    if (pending) return pending;
    const prev = entries.current.get(spaceId) ?? PENDING;
    entries.current.set(spaceId, { ...prev, loading: true });
    notify(spaceId);
    const userId = sessionRef.current?.userId ?? null;
    const p = fetchEntry(spaceId)
      .then((entry) => {
        // Cache a real (session-present) read so a later offline read can fall back.
        if (entry.loaded && userId) persistEntry(userId, spaceId, entry);
        return entry;
      })
      .catch(async () => {
        if (prev.loaded) return { ...prev, loading: false }; // in-session: keep what we had
        const cached = userId ? await loadCachedEntry(userId, spaceId) : null; // cold start
        return cached ?? { ...IDLE, loaded: true };
      })
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

  const patchRoomAutomationLocal = useCallback(
    (spaceId: string, roomId: string, patch: Partial<AutomationMeta>) => {
      const entry = entries.current.get(spaceId);
      if (!entry) return;
      const idx = entry.rooms.findIndex((r) => r.id === roomId);
      if (idx === -1) return;
      const room = entry.rooms[idx]!;
      if (!room.automation) return;
      const rooms = [...entry.rooms];
      rooms[idx] = { ...room, automation: { ...room.automation, ...patch } };
      entries.current.set(spaceId, { ...entry, rooms });
      notify(spaceId);
    },
    [notify],
  );

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
    () => ({ get, ensure, refresh, subscribe, patchRoomAutomationLocal }),
    [get, ensure, refresh, subscribe, patchRoomAutomationLocal],
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
 *  re-renders as it loads/refreshes. `null` spaceId yields an idle, empty entry.
 *
 *  Backed by `useSyncExternalStore`, NOT a subscribe-in-effect + `tick`. The entry can
 *  flip to `loaded` in the gap between this consumer's render and its subscription:
 *  the open room's `useRoom` (or any sibling consumer) reads the SAME shared registry
 *  first, so by the time we subscribe, `ensure` resolves cached and fires no notify —
 *  the old hand-rolled store then stuck forever on its first (skeleton) render.
 *  `useSyncExternalStore` re-reads the snapshot right after subscribing and re-renders
 *  if it changed, so a registry already loaded by another reader shows immediately. */
export function useRoomsRegistry(spaceId: string | null): RoomsRegistryEntry {
  const actions = useRegistryActions();
  const subscribe = useCallback(
    (onChange: () => void) => (spaceId ? actions.subscribe(spaceId, onChange) : () => {}),
    [actions, spaceId],
  );
  const getSnapshot = useCallback(
    () => (spaceId ? actions.get(spaceId) : IDLE),
    [actions, spaceId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
