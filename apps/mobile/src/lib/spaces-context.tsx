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

import { createSpace as createSpaceDoc, onSpaceMeta, readSpaces, reorderSpaces as reorderSpacesDoc } from '@drakkar.software/octochat-sdk';
import { healDmMap, isDmSpaceId, reconcileDmInbox, reconcileTicketRequests } from '@drakkar.software/octochat-sdk';
import { consumePrimedSpaces } from './spaces-prime';
import { hydrateMutes } from '@drakkar.software/octochat-sdk';
import { flushReadsNow, hydrateReads } from '@drakkar.software/octochat-sdk';
import { hydrateArchivedDms } from '@drakkar.software/octochat-sdk';
import { refreshDmHeads } from '@drakkar.software/octochat-sdk';
import { dispatchRoomChange } from './room-events-bus';
import { activeVariant } from './variants';
import { useSession } from './session-context';

interface SpacesContextValue {
  /** The identity's spaces, WITHOUT the unread overlay (added in `useSpaces`). DM
   *  spaces (`dm-` prefix) are excluded — they surface in the Direct Messages section
   *  (see `useDmMap`/`use-dms`), never as a space rail. */
  spaces: Space[];
  /** Peer userId → shared DM-space id. Drives the Direct Messages section. */
  dms: DmMap;
  /** The `dm-` space ids from the DURABLE joined-spaces list (same source as
   *  `spaces`, before `railSpaces` filters them out). Used by `UnreadProvider` to
   *  subscribe DM spaces for SSE + FCM push without depending on the lossy `dms`
   *  index — DM spaces are reliably persisted via `addJoinedSpace`/
   *  `addJoinedSpaceWithCap` on both sides of the DM. Available immediately from
   *  the primed snapshot (no async gap). */
  dmSpaceIds: string[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  createSpace: (name: string, type?: 'private' | 'public') => Promise<Space | null>;
  /** Persist a new rail order (an explicit list of rail space ids). Reorders the local
   *  list optimistically, then writes it to the synced doc so it follows the user across
   *  devices; re-reads to recover if the write fails. */
  reorderSpaces: (orderedRailIds: string[]) => Promise<void>;
  /** Move one rail space up (-1) or down (+1) relative to its current neighbour.
   *  No-op at the boundary or when `spaceId` isn't in the rail. */
  moveSpace: (spaceId: string, dir: -1 | 1) => void;
}

/** Drop DM spaces — they never belong in the space rail / switcher. */
const railSpaces = (list: Space[]): Space[] => list.filter((s) => !isDmSpaceId(s.id));

/** Desk builds (the `tickets` feature) auto-handle inbound ticket requests per space settings. */
const DESK_INTAKE = activeVariant.features.includes('tickets');

const Ctx = createContext<SpacesContextValue | null>(null);

export function SpacesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const pathname = usePathname();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [dms, setDms] = useState<DmMap>({});
  const [dmSpaceIds, setDmSpaceIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { spaces: list, mutes, reads, archivedDms, dms: dmMap } = await readSpaces(session.spacesRegistryClient, session.userId);
    const rail = railSpaces(list);
    setSpaces(rail);
    // The durable joined-spaces list is the reliable source for DM space ids — DM
    // spaces are persisted on both sides via addJoinedSpace/addJoinedSpaceWithCap,
    // unlike the lossy `dms` peer-index. Expose them for the SSE+FCM subscription
    // (see UnreadProvider) independently of the `dms` map.
    setDmSpaceIds(list.filter((s) => isDmSpaceId(s.id)).map((s) => s.id));
    // Derive DMs from the durable `dm-` spaces, not just the lossy `dms` index, so a DM
    // survives a clobbered/missing map entry and re-syncs across same-seed devices.
    setDms(dmMap);
    void healDmMap(session, list, dmMap)
      .then((healed) => {
        if (healed !== dmMap) setDms(healed);
      })
      .catch(() => {});
    setActiveId((prev) => prev ?? rail[0]?.id ?? null);
    // This `_spaces` re-pull runs on every navigation (effect below) and on app
    // foreground — the only post-startup re-read of the doc. Re-hydrate the read marks
    // and mute prefs from it too (they share the doc) so a room read or a space muted
    // on another device propagates here without an app restart. Max-merged / server-
    // authoritative in their own modules, so a stale read can't roll local state back.
    await hydrateReads(session.userId, reads);
    await hydrateMutes(session.userId, mutes);
    hydrateArchivedDms(archivedDms);
    // Refresh the DM head-timestamps (authoritative sort key for the DM list).
    // Fire-and-forget — the internal throttle absorbs nav spam; failures degrade
    // gracefully to the kv + local-cache values already in the store.
    void refreshDmHeads(session, Object.values(dmMap)).catch(() => {});
    // Accept any inbound DM invites delivered through a shared space's carrier
    // (best-effort, fire-and-forget so a carrier hiccup never blocks the rails). If a
    // new DM was accepted, re-read so its peer→space mapping reaches the DM section.
    void reconcileDmInbox(session, rail)
      .then(async (changed) => {
        if (!changed) return;
        const next = await readSpaces(session.spacesRegistryClient, session.userId);
        setDms(await healDmMap(session, next.spaces, next.dms));
      })
      .catch(() => {});
    // On a desk build, also accept inbound TICKET requests per each space's intake config
    // (auto-accept / auto-reply). Best-effort; manual-mode spaces are left for the Requests UI.
    // On a change, nudge the affected spaces' object index so the new ticket repaints in the
    // Tickets shelf without waiting for a focus-pull.
    if (DESK_INTAKE) {
      const railIds = new Set(rail.map((s) => s.id));
      void reconcileTicketRequests(session, railIds)
        .then((changed) => {
          if (changed) for (const id of railIds) dispatchRoomChange(id);
        })
        .catch(() => {});
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading spaces on session change
    setLoading(true);
    if (!session) {
      setSpaces([]);
      setDms({});
      setDmSpaceIds([]);
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
        await reorderSpacesDoc(session.spacesRegistryClient, session.userId, orderedRailIds);
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
    () => ({ spaces, dms, dmSpaceIds, activeId, setActiveId, loading, refresh, createSpace, reorderSpaces, moveSpace }),
    [spaces, dms, dmSpaceIds, activeId, loading, refresh, createSpace, reorderSpaces, moveSpace],
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
