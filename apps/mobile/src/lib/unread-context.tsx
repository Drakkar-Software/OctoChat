/**
 * App-wide unread tracking. Computes per-room / per-space unread counts from
 * decrypted messages (newer than the room's last-read mark, authored by someone
 * else) and feeds them to the existing `Badge`s in the room/space lists.
 *
 * Transport-agnostic: counts refresh on mount, app-foreground, route change and
 * a low-frequency poll. `noteRoomChanged(roomId)` is the seam a future Firebase
 * push subscription calls to update a room in real time — drop the poll once
 * that lands. See `apps/server/docs/queue-notifications.md`.
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

import { loadAllMessages } from './cross-room';
import { getLastRead, hydrateReadState, setLastRead } from './read-state';
import { useSession } from './session-context';
import type { Session } from './starfish/identity';
import { spaceIdFromRoomId } from './starfish/paths';
import { readSpaces } from './starfish/registry';

const POLL_MS = 20_000;
const MIN_REFRESH_MS = 3_000;

interface UnreadValue {
  /** Unread message count per room id (absent / 0 = caught up). */
  unreadByRoom: Record<string, number>;
  /** Unread totals per space id (sum of its rooms). */
  unreadBySpace: Record<string, number>;
  /** Grand total across all spaces — for the notifications bell badge. */
  totalUnread: number;
  /** Mark a room read up to now: clears its badge and advances its last-read. */
  markRoomRead: (roomId: string) => void;
  /** Recompute one room's count now (the real-time / Firebase seam). */
  noteRoomChanged: (roomId: string) => void;
  /** Force a full re-seed across every space. */
  refresh: () => void;
}

interface SpaceCounts {
  unread: Record<string, number>;
  newest: Record<string, number>;
  roomIds: string[];
}

/** Decrypt a space's messages and fold them into per-room unread + newest-ts. */
async function computeSpace(session: Session, spaceId: string, meId: string): Promise<SpaceCounts> {
  const msgs = await loadAllMessages(session, spaceId);
  const unread: Record<string, number> = {};
  const newest: Record<string, number> = {};
  const roomIds = new Set<string>();
  for (const { room, msg } of msgs) {
    roomIds.add(room.id);
    if (msg.ts > (newest[room.id] ?? 0)) newest[room.id] = msg.ts;
    // Only OTHER users' messages newer than what we've read count as unread.
    if (msg.authorId !== meId && msg.ts > getLastRead(room.id)) {
      unread[room.id] = (unread[room.id] ?? 0) + 1;
    }
  }
  return { unread, newest, roomIds: [...roomIds] };
}

const Ctx = createContext<UnreadValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  const newestByRoom = useRef<Record<string, number>>({});
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  // Full re-seed across every space. Throttled unless forced; never overlaps.
  const refreshAll = useCallback(
    async (force = false) => {
      const s = session;
      if (!s) {
        newestByRoom.current = {};
        setUnreadByRoom({});
        return;
      }
      const now = Date.now();
      if (runningRef.current || (!force && now - lastRunRef.current < MIN_REFRESH_MS)) return;
      runningRef.current = true;
      lastRunRef.current = now;
      try {
        const { spaces } = await readSpaces(s.accountClient, s.userId);
        const results = await Promise.all(
          spaces.map((sp) =>
            computeSpace(s, sp.id, s.userId).catch(() => ({ unread: {}, newest: {}, roomIds: [] }) as SpaceCounts),
          ),
        );
        const unread: Record<string, number> = {};
        const newest: Record<string, number> = {};
        for (const r of results) {
          Object.assign(unread, r.unread);
          Object.assign(newest, r.newest);
        }
        newestByRoom.current = newest;
        setUnreadByRoom(unread);
      } catch {
        /* keep previous counts on a transient failure */
      } finally {
        runningRef.current = false;
      }
    },
    [session],
  );

  // Recompute a single space and merge it in (used by the real-time seam).
  const refreshSpace = useCallback(
    async (spaceId: string) => {
      const s = session;
      if (!s) return;
      try {
        const { unread, newest, roomIds } = await computeSpace(s, spaceId, s.userId);
        newestByRoom.current = { ...newestByRoom.current, ...newest };
        setUnreadByRoom((prev) => {
          const next = { ...prev };
          for (const rid of roomIds) delete next[rid]; // reset this space's rooms…
          return { ...next, ...unread }; // …then apply fresh counts
        });
      } catch {
        /* ignore */
      }
    },
    [session],
  );

  const noteRoomChanged = useCallback(
    (roomId: string) => void refreshSpace(spaceIdFromRoomId(roomId)),
    [refreshSpace],
  );

  const markRoomRead = useCallback((roomId: string) => {
    setLastRead(roomId, Math.max(newestByRoom.current[roomId] ?? 0, Date.now()));
    setUnreadByRoom((prev) => {
      if (!prev[roomId]) return prev;
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, []);

  // Hydrate persisted read marks once, then seed. Re-seeds when the session changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateReadState();
      if (!cancelled) void refreshAll(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  // Low-frequency poll so badges move while the user sits on the room list.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void refreshAll(false), POLL_MS);
    return () => clearInterval(id);
  }, [session, refreshAll]);

  // App returning to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void refreshAll(true);
    });
    return () => sub.remove();
  }, [refreshAll]);

  // Navigation (throttled inside refreshAll).
  const pathname = usePathname();
  useEffect(() => {
    if (session) void refreshAll(false);
  }, [pathname, session, refreshAll]);

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
    () => ({
      unreadByRoom,
      unreadBySpace,
      totalUnread,
      markRoomRead,
      noteRoomChanged,
      refresh: () => void refreshAll(true),
    }),
    [unreadByRoom, unreadBySpace, totalUnread, markRoomRead, noteRoomChanged, refreshAll],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnread(): UnreadValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUnread must be used within UnreadProvider');
  return v;
}
