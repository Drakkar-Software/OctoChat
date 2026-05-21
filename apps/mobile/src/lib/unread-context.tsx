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
import { useGlobalSearchParams, usePathname } from 'expo-router';

import { subscribeRoomChanges } from './events';
import { ensureNotifyPermission, notifyNewMessage } from './notify';
import { useSession } from './session-context';
import { kvGet, kvSet } from './starfish/kv';
import { spaceIdFromRoomId } from './starfish/paths';
import { readSpaces } from './starfish/registry';
import { buildAuthHeaders } from './starfish/client';

interface UnreadValue {
  /** Unread count per room id (absent = caught up). */
  unreadByRoom: Record<string, number>;
  /** Unread totals per space id (sum of its rooms). */
  unreadBySpace: Record<string, number>;
  /** Grand total across all rooms — for the notifications bell / tab badge. */
  totalUnread: number;
  /** Clear a room's unread (on open, or from the notifications list). */
  markRoomRead: (roomId: string) => void;
}

const persistKey = (userId: string) => `octochat.unread.${userId}`;

const Ctx = createContext<UnreadValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  // Mirror of the map for the SSE callback + persistence — avoids stale closures
  // and keeps state updaters pure (no side effects inside setState).
  const mapRef = useRef<Record<string, number>>({});

  // The user's space ids — passed as candidates to the /events proxy.
  // Avoids useSpaces() to prevent a circular dep (use-spaces → useUnread → here).
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  // Stable sorted-join so the subscription effect only re-runs when the set changes,
  // not on every navigation that produces a new spaceIds array reference.
  const spacesKey = useMemo(() => [...spaceIds].sort().join(','), [spaceIds]);

  // Track the room currently being viewed so its events are never counted.
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string; roomId?: string }>();
  const activeRoomIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    activeRoomIdRef.current = pathname.startsWith('/room/')
      ? params.id
      : pathname.startsWith('/thread')
        ? params.roomId
        : undefined;
  }, [pathname, params.id, params.roomId]);

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
      return;
    }
    let cancelled = false;
    let unsub = () => {};
    void (async () => {
      const raw = await kvGet(persistKey(userId));
      if (cancelled) return;
      let initial: Record<string, number> = {};
      if (raw) {
        try {
          initial = JSON.parse(raw) as Record<string, number>;
        } catch {
          initial = {};
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
          if (e.roomId === activeRoomIdRef.current) return; // viewing it → already read
          const m = mapRef.current;
          const next = { ...m, [e.roomId]: (m[e.roomId] ?? 0) + 1 };
          mapRef.current = next;
          setUnreadByRoom(next);
          void kvSet(persistKey(userId), JSON.stringify(next));
          notifyNewMessage(); // web-only browser notification (no-op when focused / native)
        },
        {
          spaces: spaceIds,
          // Auth headers built fresh on each connect/reconnect (new nonce + timestamp).
          authHeaders: (method, pathAndQuery) =>
            buildAuthHeaders(session.chatCap, session.keys.edPriv, method, pathAndQuery),
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

  const unreadBySpace = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [roomId, n] of Object.entries(unreadByRoom)) {
      if (!n) continue;
      const sp = spaceIdFromRoomId(roomId);
      m[sp] = (m[sp] ?? 0) + n;
    }
    return m;
  }, [unreadByRoom]);

  const totalUnread = useMemo(
    () => Object.values(unreadByRoom).reduce((a, b) => a + b, 0),
    [unreadByRoom],
  );

  const value = useMemo<UnreadValue>(
    () => ({ unreadByRoom, unreadBySpace, totalUnread, markRoomRead }),
    [unreadByRoom, unreadBySpace, totalUnread, markRoomRead],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnread(): UnreadValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUnread must be used within UnreadProvider');
  return v;
}
