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

import { subscribeRoomChanges } from './events';
import { setDesktopBadge } from './desktop';
import { setTabTitleBadge } from './tab-title';
import { ensureNotifyPermission, notifyRoomChange } from './notify';
import { useNotificationSettings } from './notification-settings-context';
import { useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';
import { kvGet, kvSet } from './starfish/kv';
import { spaceIdFromRoomId } from './starfish/paths';
import { buildAuthHeaders } from './starfish/client';
import { dispatchRoomChange, emitSseStatus } from './room-events-bus';
import { usePush } from './push/use-push';

interface UnreadValue {
  /** Unread count per room id (absent = caught up). */
  unreadByRoom: Record<string, number>;
  /** Unread totals per space id (sum of its rooms). */
  unreadBySpace: Record<string, number>;
  /** Grand total across all rooms — for the notifications bell / tab badge. */
  totalUnread: number;
  /** Clear a room's unread (on open, or from the notifications list). */
  markRoomRead: (roomId: string) => void;
  /** The viewer's last-read timestamp for a room (ms); 0 if never read. Lets a
   *  conversation flag messages newer than the previous visit as unread. */
  lastReadAt: (roomId: string) => number;
  /** True once the persisted last-read marks have loaded from kv for the current
   *  identity. Callers MUST gate their `lastReadAt` snapshot on this: before it,
   *  the map is empty and `lastReadAt` returns 0, which would flash every thread /
   *  message as unread on a fresh page load (the marks haven't hydrated yet). */
  hydrated: boolean;
}

const persistKey = (userId: string) => `octochat.unread.${userId}`;
const lastReadKey = (userId: string) => `octochat.lastread.${userId}`;

const Ctx = createContext<UnreadValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  // Mirror of the map for the SSE callback + persistence — avoids stale closures
  // and keeps state updaters pure (no side effects inside setState).
  const mapRef = useRef<Record<string, number>>({});

  // Per-room last-read timestamp (ms), persisted per identity. Advanced on every
  // room open so messages newer than the previous visit read as "unread". Ref-only
  // (no state): it's a selector input snapshotted by callers, not reactive UI.
  const lastReadRef = useRef<Record<string, number>>({});
  // Reactive flag flipped true once lastReadRef has hydrated from kv for this
  // identity, so callers don't snapshot the empty (all-unread) map on a fresh load.
  // Monotonic per identity (only reset to false when the identity clears): a re-run
  // of the load (e.g. when the space set resolves) must NOT bounce it back to false,
  // or callers would re-snapshot after markRoomRead has advanced the mark.
  const [hydrated, setHydrated] = useState(false);

  // The user's space ids — passed as candidates to the /events proxy. Read from
  // the shared SpacesProvider (which sits above this one), NOT via useSpaces():
  // that hook overlays unread state and would create a circular dep. The provider
  // already refreshes on navigation, so a join/create propagates here for free.
  const { spaces, setActiveId } = useSpacesContext();
  const spaceIds = useMemo(() => spaces.map((s) => s.id), [spaces]);

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

  // Native push: subscribe the device to per-space FCM topics, mirroring the SSE
  // candidate set so backgrounded native apps still get notified. No-op on
  // web/desktop (those rely on the live SSE stream + notify.ts). The master toggle
  // drops every subscription when off.
  usePush(session, spaceIds, notif.enabled);

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
      setHydrated(false);
      return;
    }
    let cancelled = false;
    let unsub = () => {};
    void (async () => {
      const [raw, rawLastRead] = await Promise.all([kvGet(persistKey(userId)), kvGet(lastReadKey(userId))]);
      if (cancelled) return;
      let lastRead: Record<string, number> = {};
      if (rawLastRead) {
        try {
          lastRead = JSON.parse(rawLastRead) as Record<string, number>;
        } catch {
          lastRead = {};
        }
      }
      lastReadRef.current = lastRead;
      // Marks are loaded — flip the gate now (before the count-prune / subscribe
      // gate below, which can early-return). `cancelled` was checked just above and
      // nothing awaits between, so no stale-closure write. Stays true across re-runs.
      setHydrated(true);
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
          Object.entries(initial).filter(([roomId]) => live.has(spaceIdFromRoomId(roomId))),
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
      if (!session || spaceIds.length === 0) return;

      unsub = subscribeRoomChanges(
        (e) => {
          // Active room view: pull fresh messages there, skip the unread bump.
          if (dispatchRoomChange(e.roomId)) return;
          // My own write from another device on this account: the server forwards
          // the author identity, so skip the bump (and the toast below) — same
          // self-exclusion as the FCM push. Undefined identity (older server) falls
          // through and counts, preserving the previous behavior.
          if (e.identity && e.identity === userId) return;
          const m = mapRef.current;
          const next = { ...m, [e.roomId]: (m[e.roomId] ?? 0) + 1 };
          mapRef.current = next;
          setUnreadByRoom(next);
          void kvSet(persistKey(userId), JSON.stringify(next));
          // web/desktop notification, honoring settings (no-op when focused, disabled,
          // or native). Decrypts a preview when the `preview` setting is on. The nav
          // deps let a click resolve the room's real name/kind + focus its space.
          void notifyRoomChange(session, e.roomId, {
            ensure: ensureRef.current,
            setActiveId: setActiveIdRef.current,
          });
        },
        {
          spaces: spaceIds,
          // Auth headers built fresh on each connect/reconnect (new nonce + timestamp).
          authHeaders: (method, pathAndQuery) =>
            buildAuthHeaders(session.chatCap, session.keys.edPriv, method, pathAndQuery),
          onStatus: emitSseStatus,
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub();
    };
    // spacesKey is the stable sorted-join of spaceIds; changing it re-establishes
    // the stream when the user joins or leaves a space.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, spacesKey, session]);

  const markRoomRead = useCallback(
    (roomId: string) => {
      // Advance the read mark first — every open counts as "read up to now", so
      // messages that arrive after this stop reading as unread on the next visit.
      const lr = { ...lastReadRef.current, [roomId]: Date.now() };
      lastReadRef.current = lr;
      if (userId) void kvSet(lastReadKey(userId), JSON.stringify(lr));
      // Then clear the unread count, if any.
      const m = mapRef.current;
      if (!m[roomId]) return;
      const next = { ...m };
      delete next[roomId];
      mapRef.current = next;
      setUnreadByRoom(next);
      if (userId) void kvSet(persistKey(userId), JSON.stringify(next));
    },
    [userId],
  );

  // Read the last-read mark for a room from the live mirror (0 = never read).
  // Reads the ref so callers can snapshot it during render before markRoomRead.
  const lastReadAt = useCallback((roomId: string) => lastReadRef.current[roomId] ?? 0, []);

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

  const value = useMemo<UnreadValue>(
    () => ({ unreadByRoom, unreadBySpace, totalUnread, markRoomRead, lastReadAt, hydrated }),
    [unreadByRoom, unreadBySpace, totalUnread, markRoomRead, lastReadAt, hydrated],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnread(): UnreadValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUnread must be used within UnreadProvider');
  return v;
}
