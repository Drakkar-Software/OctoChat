/**
 * App-wide unread tracking, driven purely by the live room-change SSE stream
 * (`lib/events`). There is NO polling and NO message pulling: each SSE event
 * signals that some room changed, and we bump that room's count.
 *
 * Because chat is E2E-encrypted, the server can only tell us *which room*
 * changed — not the message id or author. "Don't count my own messages" is
 * handled by ignoring the room currently being viewed (you're inside a room
 * when you send). Counts are persisted to local kv per identity and restored on
 * reload; the SSE stream reconnects fresh (no replay).
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

import { subscribeRoomChanges } from './events';
import { setDesktopBadge } from './desktop';
import { setTabTitleBadge } from './tab-title';
import { ensureNotifyPermission, notifyNewMessage } from './notify';
import { useSession } from './session-context';
import { kvGet, kvSet } from './starfish/kv';
import { spaceIdFromRoomId } from './starfish/paths';
import { readSpaces } from './starfish/registry';
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

  // The user's space ids — passed as candidates to the /events proxy.
  // Avoids useSpaces() to prevent a circular dep (use-spaces → useUnread → here).
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  // Stable sorted-join so the subscription effect only re-runs when the set changes,
  // not on every navigation that produces a new spaceIds array reference.
  const spacesKey = useMemo(() => [...spaceIds].sort().join(','), [spaceIds]);

  const pathname = usePathname();

  // Native push: subscribe the device to per-space FCM topics, mirroring the SSE
  // candidate set so backgrounded native apps still get notified. No-op on
  // web/desktop (those rely on the live SSE stream + notify.ts).
  usePush(session, spaceIds);

  // Load the user's space ids from the registry. Re-read on navigation so a
  // join/create propagates to the subscription without a full reload. Matches
  // what use-spaces.ts does, without going through that hook (circular dep).
  useEffect(() => {
    if (!session) { setSpaceIds([]); return; }
    void readSpaces(session.accountClient, session.userId)
      .then(({ spaces }) => { setSpaceIds(spaces.map((s) => s.id)); })
      .catch(() => {});
  }, [pathname, session]);

  // Hydrate persisted counts for this identity, THEN subscribe — so an event
  // arriving right after mount builds on the restored counts, not on {}.
  useEffect(() => {
    if (!userId) {
      mapRef.current = {};
      setUnreadByRoom({});
      lastReadRef.current = {};
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

      ensureNotifyPermission();
      unsub = subscribeRoomChanges(
        (e) => {
          // Active room view: pull fresh messages there, skip the unread bump.
          if (dispatchRoomChange(e.roomId)) return;
          const m = mapRef.current;
          const next = { ...m, [e.roomId]: (m[e.roomId] ?? 0) + 1 };
          mapRef.current = next;
          setUnreadByRoom(next);
          void kvSet(persistKey(userId), JSON.stringify(next));
          notifyNewMessage(e.roomId); // web/desktop notification (no-op when focused / native)
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
    () => ({ unreadByRoom, unreadBySpace, totalUnread, markRoomRead, lastReadAt }),
    [unreadByRoom, unreadBySpace, totalUnread, markRoomRead, lastReadAt],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnread(): UnreadValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUnread must be used within UnreadProvider');
  return v;
}
