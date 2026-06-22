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

import type { DmMap, Space } from '@drakkar.software/octochat-sdk';

/**
 * View-layer extension of the lean SDK `Space` (which only carries `id`, `name`,
 * `members`). The extra fields are optional and seeded by the view layer:
 *   - `short`  — 2-char monogram, seeded from `name` at load time, overridden by SpaceMeta.
 *   - `image`  — avatar URL, set by SpaceMeta when available.
 *   - `unread` — ephemeral overlay from UnreadProvider via `useSpaces`.
 * Keeping these out of the SDK type allows the wire format to stay lean.
 */
export type SpaceView = Space & { short?: string; image?: string | null; unread?: number };

import { createSpace as createSpaceDoc, onSpaceMeta, readSpaces, reorderSpaces as reorderSpacesDoc } from '@drakkar.software/octochat-sdk';
import { healDmMap, healDmRosters, isDmSpaceId, reconcileDmInbox, reconcileTicketRequests } from '@drakkar.software/octochat-sdk';
import { isSharedRoomId, isTicketRoomId, localSpaceAccessEntries } from '@drakkar.software/octochat-sdk';
import { consumePrimedSpaces } from './spaces-prime';
import { hydrateMutes } from '@drakkar.software/octochat-sdk';
import { flushReadsNow, hydrateReads } from '@drakkar.software/octochat-sdk';
import { hydrateArchivedDms } from '@drakkar.software/octochat-sdk';
import { refreshDmHeads } from '@drakkar.software/octochat-sdk';
import { dispatchIndexChange } from './room-events-bus';
import { activeVariant } from './variants';
import { useSession } from './session-context';

interface SpacesContextValue {
  /** The identity's spaces, WITHOUT the unread overlay (added in `useSpaces`). DM
   *  spaces (`dm-` prefix) and per-node grant spaces (`shared-` / `ticket-` prefixes)
   *  are excluded — DMs surface in the Direct Messages section, grants surface in the
   *  "Shared rooms" section (see `useDmMap`/`use-dms` and `useGuestRooms`). */
  spaces: SpaceView[];
  /** Peer userId → shared DM-space id. Drives the Direct Messages section. */
  dms: DmMap;
  /** The `dm-` space ids from the DURABLE joined-spaces list (same source as
   *  `spaces`, before `railSpaces` filters them out). Used by `UnreadProvider` to
   *  subscribe DM spaces for SSE + FCM push without depending on the lossy `dms`
   *  index — DM spaces are reliably persisted via `addJoinedSpace`/
   *  `addJoinedSpaceWithCap` on both sides of the DM. Available immediately from
   *  the primed snapshot (no async gap). */
  dmSpaceIds: string[];
  /** Synthetic per-node grant spaces (`shared-` / `ticket-` prefixed) the user holds
   *  as a requester — kept out of the rail; `useGuestRooms` surfaces them. */
  guestSpaces: SpaceView[];
  /** The owner's real space ids for all per-node grants — needed to subscribe to the
   *  correct SSE streams (objinvlog lives under the owner's space, not the synthetic
   *  `shared-<hex>` space id). Used by `UnreadProvider` to widen the SSE candidate set. */
  guestOwnerSpaceIds: string[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  createSpace: (name: string, type?: 'private' | 'public') => Promise<SpaceView | null>;
  /** Persist a new rail order (an explicit list of rail space ids). Reorders the local
   *  list optimistically, then writes it to the synced doc so it follows the user across
   *  devices; re-reads to recover if the write fails. */
  reorderSpaces: (orderedRailIds: string[]) => Promise<void>;
  /** Move one rail space up (-1) or down (+1) relative to its current neighbour.
   *  No-op at the boundary or when `spaceId` isn't in the rail. */
  moveSpace: (spaceId: string, dir: -1 | 1) => void;
}

/** True for per-node grant spaces (shared rooms + requester-side ticket rooms).
 *  These synthetic Space records are injected by `claimGrantedNodes` / `acceptNodeInvite`
 *  and must never appear in the space rail — they surface in the "Shared rooms" section. */
function isGuestSpaceId(id: string): boolean {
  return isSharedRoomId(id) || isTicketRoomId(id);
}

/**
 * Scan the in-memory per-node access store to derive the OWNER'S real space ids for
 * all shared-room / ticket grants the requester holds.  These are the candidate space
 * ids for the SSE subscription — the objinvlog stream lives under the owner's space, not
 * the synthetic `shared-<hex>` space.  The store is always populated by the time
 * `SpacesProvider` calls `refresh()` (session setup hydrates it at boot).
 */
function guestOwnerSpaceIdsFromStore(): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(localSpaceAccessEntries())) {
    const colon = key.indexOf(':');
    if (colon < 0) continue;
    const nodeId = key.slice(colon + 1);
    if (isSharedRoomId(nodeId) || isTicketRoomId(nodeId)) {
      ids.add(key.slice(0, colon));
    }
  }
  return [...ids];
}

/** Drop DM spaces AND per-node grant spaces — neither belongs in the space rail / switcher.
 *  Seeds the `short` monogram so the rail renders immediately before SpaceMeta arrives. */
const railSpaces = (list: Space[]): SpaceView[] =>
  list
    .filter((s) => !isDmSpaceId(s.id) && !isGuestSpaceId(s.id))
    .map((s) => ({ ...s, short: s.name.slice(0, 2).toUpperCase() }));

/** Widen a raw SDK Space with a seeded monogram. */
const toSpaceView = (s: Space): SpaceView => ({ ...s, short: s.name.slice(0, 2).toUpperCase() });

/** Desk builds (the `tickets` feature) auto-handle inbound ticket requests per space settings. */
const DESK_INTAKE = activeVariant.features.includes('tickets');

const Ctx = createContext<SpacesContextValue | null>(null);

export function SpacesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const pathname = usePathname();
  const [spaces, setSpaces] = useState<SpaceView[]>([]);
  const [dms, setDms] = useState<DmMap>({});
  const [dmSpaceIds, setDmSpaceIds] = useState<string[]>([]);
  const [guestSpaces, setGuestSpaces] = useState<SpaceView[]>([]);
  const [guestOwnerSpaceIds, setGuestOwnerSpaceIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Minimum interval between expensive reconcile passes even on heavy refreshes.
  // reconcileDmInbox scans monthly shard buckets (?full=true) — once per minute is fine.
  // reconcileTicketRequests reads per-space indexes — same interval.
  const RECONCILE_INTERVAL_MS = 60_000;
  const lastReconcileDmAt = useRef(0);
  const lastReconcileTicketsAt = useRef(0);

  /** Heavy refresh: full cascade including DM heal + reconciles. Used on mount,
   *  foreground, space create/reorder, and post-primed-snapshot background sync. */
  const refresh = useCallback(async () => {
    if (!session) return;
    const { spaces: list, mutes, reads, archivedDms, dms: dmMap } = await readSpaces(session.spacesRegistryClient, session);
    const rail = railSpaces(list);
    setSpaces(rail);
    // The durable joined-spaces list is the reliable source for DM space ids — DM
    // spaces are persisted on both sides via addJoinedSpace/addJoinedSpaceWithCap,
    // unlike the lossy `dms` peer-index. Expose them for the SSE+FCM subscription
    // (see UnreadProvider) independently of the `dms` map.
    setDmSpaceIds(list.filter((s) => isDmSpaceId(s.id)).map((s) => s.id));
    // Per-node grant spaces (shared rooms + ticket rooms held as a requester).
    setGuestSpaces(list.filter((s) => isGuestSpaceId(s.id)).map(toSpaceView));
    setGuestOwnerSpaceIds(guestOwnerSpaceIdsFromStore());
    // Derive DMs from the durable `dm-` spaces, not just the lossy `dms` index, so a DM
    // survives a clobbered/missing map entry and re-syncs across same-seed devices.
    setDms(dmMap);
    void healDmMap(session, list, dmMap)
      .then((healed) => {
        if (healed !== dmMap) setDms(healed);
        // Repair DM access rosters: a DM whose peer is missing from `_access.members`
        // gets NO live notifications/unread, because the /events SSE proxy + FCM bridge
        // authorize from the roster (not the member cap that gates reads). Owner-only
        // writes, idempotent; each side heals the DMs it owns. Best-effort.
        return healDmRosters(session, healed);
      })
      .catch(() => {});
    setActiveId((prev) => prev ?? rail[0]?.id ?? null);
    // Re-hydrate the read marks and mute prefs so a room read or a space muted on another
    // device propagates here without an app restart. Max-merged / server-authoritative in
    // their own modules, so a stale read can't roll local state back.
    await hydrateReads(session.userId, reads);
    await hydrateMutes(session.userId, mutes);
    hydrateArchivedDms(archivedDms);
    // Refresh the DM head-timestamps (authoritative sort key for the DM list).
    // Fire-and-forget — the internal throttle absorbs spam; failures degrade gracefully.
    void refreshDmHeads(session, Object.values(dmMap)).catch(() => {});
    // Accept any inbound DM invites — throttled: monthly shards change rarely, so scanning
    // them on every heavy refresh is wasted. One pass per RECONCILE_INTERVAL_MS.
    const now = Date.now();
    if (now - lastReconcileDmAt.current >= RECONCILE_INTERVAL_MS) {
      lastReconcileDmAt.current = now;
      void reconcileDmInbox(session, rail)
        .then(async (changed) => {
          if (!changed) return;
          const next = await readSpaces(session.spacesRegistryClient, session);
          const healed = await healDmMap(session, next.spaces, next.dms);
          setDms(healed);
          // A freshly-accepted DM must land its peer in `_access.members` too (see above).
          await healDmRosters(session, healed);
        })
        .catch(() => {});
    }
    // On a desk build, also accept inbound TICKET requests per each space's intake config
    // (auto-accept / auto-reply). Best-effort; manual-mode spaces are left for the Requests UI.
    // Throttled: reads per-space indexes so we skip if one ran recently.
    if (DESK_INTAKE && now - lastReconcileTicketsAt.current >= RECONCILE_INTERVAL_MS) {
      lastReconcileTicketsAt.current = now;
      const railIds = new Set(rail.map((s) => s.id));
      void reconcileTicketRequests(session, railIds)
        .then((changed) => {
          // Nudge the objindex store so new tickets paint in the Tickets shelf immediately.
          if (changed) for (const id of railIds) dispatchIndexChange(id);
        })
        .catch(() => {});
    }
  }, [session]);

  /** Light refresh: re-reads `_spaces` + hydrates reads/mutes/DM heads only.
   *  No DM heal, no reconcile passes — used on navigation to keep the space rail
   *  current without triggering the expensive per-space/per-DM cascade. */
  const refreshLight = useCallback(async () => {
    if (!session) return;
    const { spaces: list, mutes, reads, archivedDms, dms: dmMap } = await readSpaces(session.spacesRegistryClient, session);
    const rail = railSpaces(list);
    setSpaces(rail);
    setDmSpaceIds(list.filter((s) => isDmSpaceId(s.id)).map((s) => s.id));
    setGuestSpaces(list.filter((s) => isGuestSpaceId(s.id)).map(toSpaceView));
    setGuestOwnerSpaceIds(guestOwnerSpaceIdsFromStore());
    setDms(dmMap);
    setActiveId((prev) => prev ?? rail[0]?.id ?? null);
    await hydrateReads(session.userId, reads);
    await hydrateMutes(session.userId, mutes);
    hydrateArchivedDms(archivedDms);
    void refreshDmHeads(session, Object.values(dmMap)).catch(() => {});
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading spaces on session change
    setLoading(true);
    if (!session) {
      setSpaces([]);
      setDms({});
      setDmSpaceIds([]);
      setGuestSpaces([]);
      setGuestOwnerSpaceIds([]);
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
      // Paint the rail instantly from the primed snapshot…
      const rail = railSpaces(primed);
      setSpaces(rail);
      // The primed list IS the full _spaces list — extract DM space ids from it
      // immediately so the SSE + FCM subscription covers DMs on first paint (same
      // timing as rooms). Without this, dmSpaceIds stays [] until refresh() below
      // completes, creating a window where DM messages arrive unsubscribed.
      setDmSpaceIds(primed.filter((s) => isDmSpaceId(s.id)).map((s) => s.id));
      setGuestSpaces(primed.filter((s) => isGuestSpaceId(s.id)));
      setGuestOwnerSpaceIds(guestOwnerSpaceIdsFromStore());
      setActiveId((prev) => prev ?? rail[0]?.id ?? null);
      setLoading(false);
      // …but the prime only carries the spaces array, NOT the `dms` map — so the
      // virtual DM space would read empty until the first navigation. Kick a
      // background refresh to hydrate `dms` (+ accept any inbound invites) now.
      void refresh().catch(() => {});
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
  // Light path only: navigating between rooms/spaces must NOT fan out per-DM
  // _access reads, monthly shard scans, or per-space index reconciles — those
  // run on mount/foreground via the full `refresh()`.
  // Throttled: rapid navigation can fire this effect many times per second.
  const mountedRef = useRef(false);
  const lastNavRefreshAt = useRef(0);
  useEffect(() => {
    if (!session) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const now = Date.now();
    if (now - lastNavRefreshAt.current < 5_000) return;
    lastNavRefreshAt.current = now;
    void refreshLight().catch(() => {});
  }, [pathname, session, refreshLight]);

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
    async (name: string, _type: 'private' | 'public' = 'private'): Promise<Space | null> => {
      if (!session) return null;
      // All spaces share the same creation path — access is now per-node (room),
      // not per-space. A "public" room is a node with access:'public'.
      const space = await createSpaceDoc(session, name);
      await refresh();
      setActiveId(space.id);
      return space;
    },
    [session, refresh],
  );

  const reorderSpaces = useCallback(
    async (orderedRailIds: string[]) => {
      if (!session) return;
      // Optimistic: reorder the local rail to match the dropped order immediately, so the
      // tile lands without waiting for the round-trip. Tail entries `orderedRailIds`
      // didn't mention (shouldn't happen for the rail, but defensive) keep their place.
      const order = new Map(orderedRailIds.map((id, i) => [id, i]));
      const reordered = (list: Space[]) =>
        [...list].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
      setSpaces((prev) => reordered(prev));
      try {
        await reorderSpacesDoc(session.spacesRegistryClient, session, orderedRailIds);
      } catch {
        // Write failed — re-read the authoritative doc so the rail can't drift from the
        // server (e.g. a stuck optimistic order the next device never sees).
        void refresh().catch(() => {});
      }
    },
    [session, refresh],
  );

  const moveSpace = useCallback(
    (spaceId: string, dir: -1 | 1) => {
      const ids = spaces.map((s) => s.id);
      const i = ids.indexOf(spaceId);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      void reorderSpaces(ids);
    },
    [spaces, reorderSpaces],
  );

  const value = useMemo<SpacesContextValue>(
    () => ({ spaces, dms, dmSpaceIds, guestSpaces, guestOwnerSpaceIds, activeId, setActiveId, loading, refresh, createSpace, reorderSpaces, moveSpace }),
    [spaces, dms, dmSpaceIds, guestSpaces, guestOwnerSpaceIds, activeId, loading, refresh, createSpace, reorderSpaces, moveSpace],
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
