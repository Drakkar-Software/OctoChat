/**
 * App-wide unread tracking, driven purely by the live room-change SSE stream
 * (`lib/events`). There is NO polling, and no message pulling for the unread count
 * itself: each SSE event signals that some room changed, and we bump that room's
 * count. (The one exception is the optional notification preview — when the user
 * enables it, `notifyRoomChange` pulls + decrypts the changed room's latest message
 * to build the toast body; the count path stays pull-free.)
 *
 * Because chat is E2E-encrypted, the server can't tell us the message id or text,
 * but it does forward the write's author `identity` (account-level user id). We
 * skip our own writes two ways: the room currently being viewed (you're inside it
 * when you send on this device), and any event whose `identity` is ours (a send
 * from ANOTHER device on the same account) — the same self-exclusion the FCM push
 * uses, so the unread badge no longer counts messages you sent. Counts are persisted
 * to local kv per identity and restored on reload; the SSE stream reconnects fresh
 * (no replay).
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
import { InteractionManager } from 'react-native';

import { subscribeRoomChanges } from '@drakkar.software/octochat-sdk';
import { setDesktopBadge } from './desktop';
import { setTabTitleBadge } from './tab-title';
import { ensureNotifyPermission, notifyRoomChange } from './notify';
import { isMuted } from '@drakkar.software/octochat-sdk';
import { isDmArchived, setDmArchived } from '@drakkar.software/octochat-sdk';
import { useMutes } from './mutes-context';
import { getReadPrefs, loadReadMarksFromKv, setRoomReadAt, subscribeReads } from '@drakkar.software/octochat-sdk';
import { useNotificationSettings } from './notification-settings-context';
import { useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';
import { kvGet, kvSet } from '@drakkar.software/octochat-sdk';
import { isDmInboxRoomId, isDmSpaceId, isSharedRoomId, isTicketRoomId } from '@drakkar.software/octochat-sdk';
import { spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';
import { buildAuthHeaders } from '@drakkar.software/octochat-sdk';
import { computeDmUnreadSeed, getDmHeads, refreshDmHeads } from '@drakkar.software/octochat-sdk';
import { dispatchRoomChange, dispatchIndexChange, emitSseStatus } from './room-events-bus';
import { usePush } from './push/use-push';
import { advanceRoomActivity, hydrateLatestActivity, resetLatestActivity } from './latest-activity';

/** Reactive unread counts — changes on every SSE bump. Separate context so
 *  action-only consumers (threads, room screen) don't re-render on every bump. */
interface UnreadCountsValue {
  /** Unread count per room id (absent = caught up). */
  unreadByRoom: Record<string, number>;
  /** Unread totals per space id (sum of its rooms). */
  unreadBySpace: Record<string, number>;
  /** Grand total across all rooms — for the notifications bell / tab badge. */
  totalUnread: number;
  /** True once the persisted last-read marks have loaded from kv for the current
   *  identity. Callers MUST gate their `lastReadAt` snapshot on this: before it,
   *  the map is empty and `lastReadAt` returns 0, which would flash every thread /
   *  message as unread on a fresh page load (the marks haven't hydrated yet). */
  hydrated: boolean;
}

/** Stable read/write actions — changes only on identity switch.
 *  Separate context so count-only consumers don't re-render on action changes. */
interface UnreadActionsValue {
  /** Clear a room's unread (on open, or from the notifications list). */
  markRoomRead: (roomId: string) => void;
  /** The viewer's last-read timestamp for a room (ms); 0 if never read. Lets a
   *  conversation flag messages newer than the previous visit as unread. */
  lastReadAt: (roomId: string) => number;
}

/** Combined shape — kept for callers that need both; prefer the narrower hooks. */
type UnreadValue = UnreadCountsValue & UnreadActionsValue;

const persistKey = (userId: string) => `octochat.unread.${userId}`;

const CountsCtx = createContext<UnreadCountsValue | null>(null);
const ActionsCtx = createContext<UnreadActionsValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  // Mirror of the map for the SSE callback + persistence — avoids stale closures
  // and keeps state updaters pure (no side effects inside setState).
  const mapRef = useRef<Record<string, number>>({});

  // Per-room last-read timestamp (ms). A local MIRROR of the synced read-mark cache
  // (`reads.ts` — stored in the `_spaces` doc, shared across the user's devices), kept
  // here as a ref because callers snapshot it during render (a selector input, not
  // reactive UI) before `markRoomRead` advances it. Seeded from kv on hydrate and kept
  // in sync by the `subscribeReads` reconcile below, which also clears the unread count
  // for any room whose mark advanced on ANOTHER device.
  const lastReadRef = useRef<Record<string, number>>({});
  // Reactive flag flipped true once lastReadRef has hydrated from kv for this
  // identity, so callers don't snapshot the empty (all-unread) map on a fresh load.
  // Monotonic per identity (only reset to false when the identity clears): a re-run
  // of the load (e.g. when the space set resolves) must NOT bounce it back to false,
  // or callers would re-snapshot after markRoomRead has advanced the mark.
  const [hydrated, setHydrated] = useState(false);

  // Gate the SSE subscription until after the first frame so the initial render
  // (spaces rail + rooms skeleton) paints before any network connections open.
  const [sseReady, setSseReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setSseReady(true));
    return () => task.cancel();
  }, []);

  // Stable helper: commit a new counts map to all three storage locations (in-memory
  // ref, React state, and kv persistence). Extracted to avoid the three-line repeat
  // in the SSE bump, reconcileReads, markRoomRead, and the DM seed effect.
  // Called only from effects/callbacks that already hold the current userId.
  const commitCounts = useCallback(
    (next: Record<string, number>) => {
      mapRef.current = next;
      setUnreadByRoom(next);
      if (userId) void kvSet(persistKey(userId), JSON.stringify(next));
    },
    [userId],
  );

  // The user's space ids — passed as candidates to the /events proxy. Read from
  // the shared SpacesProvider (which sits above this one), NOT via useSpaces():
  // that hook overlays unread state and would create a circular dep. The provider
  // already refreshes on navigation, so a join/create propagates here for free.
  const { spaces, dms, dmSpaceIds, guestOwnerSpaceIds, setActiveId } = useSpacesContext();
  // DM spaces are kept out of the visible `spaces` list (no rail tile — see
  // starfish/dm.ts), but their rooms still need the live SSE stream + unread
  // aggregation like any other room. Union DM space ids into the candidate set
  // from TWO sources (both deduped by the Set):
  //
  //   1. `dmSpaceIds` — the `dm-` ids extracted from the DURABLE joined-spaces
  //      list in SpacesProvider. This is populated immediately on first paint
  //      (even from the primed snapshot) so DM spaces are subscribed as early as
  //      rooms, with no async gap. This is the primary source.
  //
  //   2. `Object.values(dms)` — the peer→space index, kept as a belt-and-
  //      suspenders for any DM that is in the index but somehow missing from the
  //      joined list (shouldn't happen for a fully-established DM, but defensive).
  //
  // Without the DM ids here the server forwards no room-change event for a DM
  // space, so an open DM never live-pulls a peer's message and DM unread is
  // pruned on hydrate (the prune below drops rooms whose space isn't in this set).
  const spaceIds = useMemo(
    () => [...new Set([...spaces.map((s) => s.id), ...dmSpaceIds, ...Object.values(dms), ...guestOwnerSpaceIds])],
    [spaces, dmSpaceIds, dms, guestOwnerSpaceIds],
  );

  // Deps for resolving a clicked toast's room name/kind + focusing its space (web/
  // desktop; see `openRoomFromNotification`). Read through refs so the long-lived
  // SSE subscription closure always calls the current functions, not stale ones.
  const { ensure } = useRoomsRegistryActions();
  const ensureRef = useRef(ensure);
  const setActiveIdRef = useRef(setActiveId);
  useEffect(() => {
    ensureRef.current = ensure;
    setActiveIdRef.current = setActiveId;
  });
  // Stable sorted-join so the subscription effect only re-runs when the set changes,
  // not on every navigation that produces a new spaceIds array reference.
  const spacesKey = useMemo(() => [...spaceIds].sort().join(','), [spaceIds]);

  // Notification preferences (per identity) gate both push and web toasts.
  const { settings: notif } = useNotificationSettings();

  // Mute prefs: consumed here so the provider re-renders (and the push set below
  // recomputes) the instant a space is muted/unmuted. The SSE candidate set stays
  // UNFILTERED (see `subscribeRoomChanges` below) — dropping a muted space there
  // would kill live updates for a muted room you're actively viewing.
  const mutes = useMutes();

  // Native push: subscribe the device to per-space FCM topics. A MUTED space is
  // dropped from this set so its topic is unsubscribed — the only layer that stops a
  // native banner (the OS renders the bridge's push before any JS runs). No-op on
  // web/desktop (those rely on the live SSE stream + notify.ts); the master toggle
  // drops every subscription when off.
  const pushSpaceIds = useMemo(
    () => spaceIds.filter((id) => !mutes.isSpaceMuted(id)),
    [spaceIds, mutes],
  );
  usePush(session, pushSpaceIds, notif.enabled);

  // Request browser-notification permission once notifications are enabled
  // (web/desktop; no-op on native). Re-asks when the user flips the toggle on.
  useEffect(() => {
    if (notif.enabled) ensureNotifyPermission();
  }, [notif.enabled]);

  // Hydrate persisted counts for this identity, THEN subscribe — so an event
  // arriving right after mount builds on the restored counts, not on {}.
  useEffect(() => {
    if (!userId) {
      mapRef.current = {};
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear unread counts when the identity (userId) clears
      setUnreadByRoom({});
      lastReadRef.current = {};
      resetLatestActivity();
      setHydrated(false);
      return;
    }
    let cancelled = false;
    let unsub = () => {};
    let unsubReads = () => {};
    void (async () => {
      // Read marks now come from the synced `reads` cache (persisted to its own kv,
      // folding the legacy `octochat.lastread` map). This seeds the mirror with THIS
      // device's own marks; cross-device marks merged in by `hydrateReads` arrive via
      // the reconcile subscription below.
      // latest-activity hydration runs concurrently and self-manages via the
      // module store in latest-activity.ts (sets activeKey, max-merges from kv).
      const [raw, marks] = await Promise.all([
        kvGet(persistKey(userId)),
        loadReadMarksFromKv(userId),
        hydrateLatestActivity(userId),
      ]);
      if (cancelled) return;
      lastReadRef.current = marks;
      // Marks are loaded — flip the gate now (before the count-prune / subscribe
      // gate below, which can early-return). `cancelled` was checked just above and
      // nothing awaits between, so no stale-closure write. Stays true across re-runs.
      setHydrated(true);

      // Reconcile the unread COUNT against the synced read marks: when a room's mark
      // advances past our mirror — because it was read on ANOTHER device (or by our own
      // `markRoomRead`, idempotently) — clear that room's unread count to 0. The badge
      // counter has no per-message timestamps, so this is "the other device read it →
      // assume caught up"; a message that landed between the two devices' read times is
      // dropped from the count (accepted approximation — see the feature plan).
      const reconcileReads = () => {
        const next = getReadPrefs().nodes;
        const prev = lastReadRef.current;
        const mirror = { ...prev };
        const counts = { ...mapRef.current };
        let marksChanged = false;
        let countsChanged = false;
        for (const [roomId, ts] of Object.entries(next)) {
          if (ts > (prev[roomId] ?? 0)) {
            mirror[roomId] = ts;
            marksChanged = true;
            if (counts[roomId]) {
              delete counts[roomId];
              countsChanged = true;
            }
          }
        }
        if (marksChanged) lastReadRef.current = mirror;
        if (countsChanged) commitCounts(counts);
      };
      unsubReads = subscribeReads(reconcileReads);
      // Catch any advance already emitted before we subscribed (e.g. the startup
      // `hydrateReads` server-merge that ran before this provider mounted).
      reconcileReads();
      let initial: Record<string, number> = {};
      if (raw) {
        try {
          initial = JSON.parse(raw) as Record<string, number>;
        } catch {
          initial = {};
        }
      }
      // Drop unread for spaces the user has left: leaving removes the space from
      // the registry but not its rooms' counts, and those orphans would inflate
      // the Activity counter forever (no tile/row can clear them). Gated on a
      // loaded, non-empty space set so a pre-load empty set never wipes live counts.
      if (spaceIds.length > 0) {
        const live = new Set(spaceIds);
        const pruned = Object.fromEntries(
          Object.entries(initial).filter(([roomId]) => {
            if (isDmInboxRoomId(roomId)) return false; // carrier — never a real room
            // Ticket rooms (`ticket-<hex>`) are exempt: their id has NO embedded space, so
            // `spaceIdFromRoomId` returns the id itself (never in `live`) and the prune would
            // wipe persisted ticket unread on every restart. A ticket isn't "left" either —
            // its count clears on read. (Same posture as DMs below.)
            if (isTicketRoomId(roomId)) return true;
            // Shared rooms (`shared-<hex>`) are exempt for the same reason: no embedded space.
            if (isSharedRoomId(roomId)) return true;
            const sp = spaceIdFromRoomId(roomId);
            // DM rooms are exempt from the left-space prune: the `dms` map isn't in
            // `spaceIds` yet on a cold start (the primed-spaces fast path carries no
            // `dms`), and a DM is never "left" — its count clears on read/reconcile,
            // not on space removal. Pruning here wiped persisted DM unread on restart.
            return isDmSpaceId(sp) || live.has(sp);
          }),
        );
        if (Object.keys(pruned).length !== Object.keys(initial).length) {
          initial = pruned;
          void kvSet(persistKey(userId), JSON.stringify(pruned));
        }
      }
      mapRef.current = initial;
      setUnreadByRoom(initial);

      // Skip subscribing when the user has no spaces — the server sentinel is the
      // real guard, but there's no value in connecting with an empty candidate set.
      // Also skip until the first frame has painted: sseReady is flipped by
      // InteractionManager.runAfterInteractions so the rooms skeleton renders before
      // any network connection opens. The effect re-runs when sseReady becomes true.
      if (!sseReady || !session || spaceIds.length === 0) return;

      unsub = subscribeRoomChanges(
        (e) => {
          // Object-index events (node create/rename): pull the objindex store so the
          // ticket/room list repaints on every member's device, then bail — index
          // changes must never bump unread counts.
          if (e.kind === 'index') {
            if (e.spaceId) dispatchIndexChange(e.spaceId);
            return;
          }

          // The DM-invite carrier rides a `streamchat` doc inside a shared space, so its
          // appends fire a change event keyed on THAT space — which would otherwise
          // inflate the host space's badge + create a phantom room counter. It's never a
          // real room (not in any registry), so drop it entirely: no bump, no toast.
          if (isDmInboxRoomId(e.roomId)) return;

          // ── Recency tracking: advance the module-level activity store so use-dms.ts
          // re-sorts immediately via useSyncExternalStore. Fires BEFORE all early-returns
          // so your own sends and the actively-viewed room also advance the sort order. ──
          const eventTs = e.ts ?? Date.now();
          advanceRoomActivity(e.roomId, eventTs);

          // ── Auto-resurface: an incoming message un-archives the DM (Messenger-
          // style) so an unread DM is never hidden from the list. ─────────────────
          const spaceId = e.spaceId ?? spaceIdFromRoomId(e.roomId);
          if (isDmArchived(spaceId)) {
            void setDmArchived(session, spaceId, false);
          }

          // Active room view: pull fresh messages there, skip the unread bump.
          if (dispatchRoomChange(e.roomId)) return;
          // My own write from another device on this account: the server forwards
          // the author identity, so skip the bump (and the toast below) — same
          // self-exclusion as the FCM push. Undefined identity (older server) falls
          // through and counts, preserving the previous behavior.
          if (e.identity && e.identity === userId) return;
          // Unread is KEPT for muted rooms/spaces (silence-only) — bump it regardless.
          const m = mapRef.current;
          commitCounts({ ...m, [e.roomId]: (m[e.roomId] ?? 0) + 1 });
          // web/desktop notification, honoring settings (no-op when focused, disabled,
          // or native). Decrypts a preview when the `preview` setting is on. The nav
          // deps let a click resolve the room's real name/kind + focus its space.
          // Skipped when the room (or its whole space) is muted — the sync mute cache
          // reads correctly inside this long-lived SSE closure (no stale React state).
          if (!isMuted(e.roomId, e.spaceId ?? spaceIdFromRoomId(e.roomId))) {
            void notifyRoomChange(session, e.roomId, e.spaceId, {
              ensure: ensureRef.current,
              setActiveId: setActiveIdRef.current,
            });
          }
        },
        {
          spaces: spaceIds,
          // Auth headers built fresh on each connect/reconnect (new nonce + timestamp).
          authHeaders: (method, pathAndQuery) =>
            buildAuthHeaders(session.contentCap, session.keys.edPriv, method, pathAndQuery),
          onStatus: emitSseStatus,
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub();
      unsubReads();
    };
    // spacesKey is the stable sorted-join of spaceIds; changing it re-establishes
    // the stream when the user joins or leaves a space. sseReady fires after the
    // first frame to avoid contending with the initial render pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, spacesKey, session, sseReady]);

  const markRoomRead = useCallback(
    (roomId: string) => {
      // Advance the read mark first — every open counts as "read up to now", so
      // messages that arrive after this stop reading as unread on the next visit. We
      // update the local mirror AND push through the synced read cache (`setRoomReadAt`:
      // optimistic + debounced sync to the `_spaces` doc) so other devices clear too.
      const ts = Date.now();
      lastReadRef.current = { ...lastReadRef.current, [roomId]: ts };
      if (session) setRoomReadAt(session, roomId, ts);
      // Then clear the unread count, if any.
      const m = mapRef.current;
      if (!m[roomId]) return;
      const next = { ...m };
      delete next[roomId];
      commitCounts(next);
    },
    [session, commitCounts],
  );

  // Read the last-read mark for a room from the live mirror (0 = never read).
  // Reads the ref so callers can snapshot it during render before markRoomRead.
  const lastReadAt = useCallback((roomId: string) => lastReadRef.current[roomId] ?? 0, []);

  // Stable sorted-join of DM space ids — so the seed effect only re-fires when the
  // set of DM spaces actually changes (a newly-accepted DM), not on every render.
  const dmSpacesKey = useMemo(() => [...dmSpaceIds].sort().join(','), [dmSpaceIds]);

  // Seed unread for DMs whose authoritative head timestamp is newer than the read
  // mark but whose room has no live SSE count yet. This covers:
  //   – messages that arrived before the space was subscribed (new DM invitation
  //     accepted asynchronously; SSE stream has no replay).
  //   – cold-start where the kv snapshot has no entry (first-time, or cleared).
  //
  // Gated on `hydrated` so read marks are loaded before comparing (avoids seeding
  // a DM that was already read on another device). Re-fires when `dmSpaceIds`
  // changes (a newly-accepted DM enters the durable set).
  //
  // `commitCounts` is stable per-userId and idempotent; `computeDmUnreadSeed`
  // returns null when nothing changed, so no spurious state updates.
  useEffect(() => {
    if (!hydrated || !session || dmSpaceIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      // refreshDmHeads is throttled to 15s + coalesces in-flight; calling it here
      // is safe alongside the <DmList> useRefreshDmHeads() call.
      await refreshDmHeads(session, dmSpaceIds).catch(() => {});
      if (cancelled) return;
      const next = computeDmUnreadSeed(
        dmSpaceIds,
        getDmHeads(),
        getReadPrefs().nodes,
        mapRef.current,
      );
      if (next) commitCounts(next);
    })();
    return () => { cancelled = true; };
    // dmSpacesKey is the stable sorted-join so the effect re-runs only when the DM
    // set changes, not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, session, dmSpacesKey, commitCounts]);

  const unreadBySpace = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [roomId, n] of Object.entries(unreadByRoom)) {
      if (!n) continue;
      const sp = spaceIdFromRoomId(roomId);
      m[sp] = (m[sp] ?? 0) + n;
    }
    return m;
  }, [unreadByRoom]);

  // Sum only over spaces the user is currently in — the same set the space tiles
  // render — so the Activity bell / tab badge can't be stuck above zero by orphan
  // counts from spaces that are no longer in the registry.
  const totalUnread = useMemo(
    () => spaceIds.reduce((n, sid) => n + (unreadBySpace[sid] ?? 0), 0),
    [unreadBySpace, spaceIds],
  );

  // Mirror the unread total on the desktop dock / taskbar badge. No-op on
  // web/native; clears as rooms are marked read and the total shrinks.
  useEffect(() => {
    setDesktopBadge(totalUnread);
  }, [totalUnread]);

  // Prefix the browser tab title with the unread count, e.g. "(3) OctoChat".
  // Web/desktop only; clears back to the bare title at zero.
  useEffect(() => {
    setTabTitleBadge(totalUnread);
  }, [totalUnread]);

  const counts = useMemo<UnreadCountsValue>(
    () => ({ unreadByRoom, unreadBySpace, totalUnread, hydrated }),
    [unreadByRoom, unreadBySpace, totalUnread, hydrated],
  );
  const actions = useMemo<UnreadActionsValue>(
    () => ({ markRoomRead, lastReadAt }),
    [markRoomRead, lastReadAt],
  );

  return (
    <CountsCtx.Provider value={counts}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </CountsCtx.Provider>
  );
}

/** Subscribe to reactive unread counts (bumps on every SSE event). Use this in room
 *  lists, badges, and any component that shows counts. */
export function useUnreadCounts(): UnreadCountsValue {
  const v = useContext(CountsCtx);
  if (!v) throw new Error('useUnreadCounts must be used within UnreadProvider');
  return v;
}

/** Subscribe to stable read/write actions (changes only on identity switch). Use this
 *  in thread/room screens that only need `markRoomRead` / `lastReadAt`. */
export function useUnreadActions(): UnreadActionsValue {
  const v = useContext(ActionsCtx);
  if (!v) throw new Error('useUnreadActions must be used within UnreadProvider');
  return v;
}

/** Convenience hook for callers that need both counts and actions.
 *  Prefer the narrower hooks (`useUnreadCounts`, `useUnreadActions`) so a component
 *  only re-renders from the context it actually reads. */
export function useUnread(): UnreadValue {
  return { ...useUnreadCounts(), ...useUnreadActions() };
}

/** Format an unread count for a bottom-tab badge: `undefined` at zero (so the
 *  trigger hides the badge), capped at "99+". Shared by every native tab badge
 *  (Chat · Agents · DMs) so the cap + hide-on-zero rule stays in one place. */
export function tabBadgeLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}
