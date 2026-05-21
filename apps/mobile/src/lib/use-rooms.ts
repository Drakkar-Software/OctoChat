import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Room } from '@/lib/types';

import { createRoom as createRoomDoc, readRooms } from './starfish/registry';
import { useSession } from './session-context';

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

/** Rooms of a space, grouped by category, with a creator action. */
export function useRooms(spaceId: string | null) {
  const { session } = useSession();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session || !spaceId) return;
    const { rooms: list } = await readRooms(session.accountClient, spaceId);
    setRooms(list);
  }, [session, spaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!session || !spaceId) {
      setRooms([]);
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
  }, [session, spaceId, refresh]);

  const categories = useMemo<RoomCategory[]>(() => {
    const map = new Map<string, Room[]>();
    for (const r of rooms) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return [...map.entries()].map(([name, rs]) => ({ name, rooms: rs }));
  }, [rooms]);

  const createRoom = useCallback(
    async (name: string, category?: string) => {
      if (!session || !spaceId) return;
      await createRoomDoc(session.accountClient, session.userId, spaceId, name, category);
      await refresh();
    },
    [session, spaceId, refresh],
  );

  return { categories, rooms, loading, createRoom };
}
