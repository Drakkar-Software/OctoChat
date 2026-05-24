import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Room } from '@/lib/types';

import { createRoom as createRoomDoc, readRooms, reconcileSpaceMeta } from './starfish/registry';
import {
  createPublicRoom,
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  readPublicRoomsDoc,
} from './starfish/pubspace';
import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';
import { useUnread } from './unread-context';

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

/** Adding a channel writes the `space:owner`-gated room registry, so only the
 *  owner may do it; a member is told to ask rather than the call rejecting. */
const NOT_OWNER_MESSAGE = 'Only the space owner can create channels — ask the owner to add this one.';
const CREATE_FAILED_MESSAGE = "Couldn't create the channel. Please try again.";

/** Rooms of a space, grouped by category, with an owner-gated creator action. */
export function useRooms(spaceId: string | null) {
  const { session } = useSession();
  const { unreadByRoom } = useUnread();
  const { spaces } = useSpacesContext();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const isPublic = !!spaceId && isPublicSpaceId(spaceId);

  // Snapshot the known spaces for reconcileSpaceMeta's fast path, via a ref so it
  // doesn't pull `spaces` into `refresh`'s deps (which would refetch rooms on every
  // space-list change). When the snapshot already matches, reconcile skips its read.
  const spacesRef = useRef(spaces);
  // Sync after each render (not during — writing a ref in render trips
  // react-hooks/refs); `refresh` reads it from later effects / user actions.
  useEffect(() => {
    spacesRef.current = spaces;
  });

  // Overlay live unread counts onto the registry rooms so `ChannelRow`'s Badge
  // and emphasis light up without the row components touching the provider.
  const roomsWithUnread = useMemo<Room[]>(
    () => rooms.map((r) => ({ ...r, unread: unreadByRoom[r.id] ?? 0 })),
    [rooms, unreadByRoom],
  );

  const refresh = useCallback(async () => {
    if (!session || !spaceId) return;
    if (isPublicSpaceId(spaceId)) {
      const auth = publicSpaceAuth(session, spaceId);
      const { rooms: list, name, image } = await readPublicRoomsDoc(
        publicSpaceClient(session, spaceId),
        auth.ownerId,
        spaceId,
      );
      setRooms(list);
      setOwner(auth.ownerId); // only the path owner may add channels
      setMembers([]); // public spaces have no roster (access is by cap, not membership)
      // Fold the owner's shared name/image into our own _spaces cache (best-effort;
      // the known-spaces snapshot lets it skip the read when already in sync).
      void reconcileSpaceMeta(
        session.accountClient,
        session.userId,
        spaceId,
        { name, image },
        spacesRef.current,
      ).catch(() => {});
      return;
    }
    const { rooms: list, owner: o, members: roster, name, image } = await readRooms(session.accountClient, spaceId);
    setRooms(list);
    setOwner(o);
    setMembers(roster);
    void reconcileSpaceMeta(
      session.accountClient,
      session.userId,
      spaceId,
      { name, image },
      spacesRef.current,
    ).catch(() => {});
  }, [session, spaceId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading rooms on space/session change
    setLoading(true);
    if (!session || !spaceId) {
      setRooms([]);
      setOwner(null);
      setMembers([]);
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
    for (const r of roomsWithUnread) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return [...map.entries()].map(([name, rs]) => ({ name, rooms: rs }));
  }, [roomsWithUnread]);

  /** True when the signed-in identity owns this space (and so may add channels). */
  const isOwner = !!session && owner !== null && owner === session.userId;

  // Owner + roster, mirroring the space screen. Public spaces have no roster
  // (access is cap-based), so their count is unknown → null.
  const memberCount = isPublic ? null : 1 + members.length;

  /**
   * Create a channel. Resolves to `null` on success, or a user-facing message
   * to surface when it can't — chiefly the owner-only registry write: a member
   * is told to ask the owner instead of the promise rejecting unhandled.
   */
  const createRoom = useCallback(
    async (name: string, category?: string): Promise<string | null> => {
      if (!session || !spaceId) return null;
      // Known non-owner: skip the doomed write and explain it directly.
      if (owner !== null && owner !== session.userId) return NOT_OWNER_MESSAGE;
      try {
        if (isPublicSpaceId(spaceId)) {
          await createPublicRoom(session, spaceId, name, category);
        } else {
          await createRoomDoc(session.accountClient, session.userId, spaceId, name, category);
        }
        await refresh();
        return null;
      } catch (e) {
        // The registry write is owner-gated; a 403 means we aren't it.
        if ((e as { status?: number })?.status === 403) return NOT_OWNER_MESSAGE;
        return CREATE_FAILED_MESSAGE;
      }
    },
    [session, spaceId, owner, refresh],
  );

  return { categories, rooms: roomsWithUnread, loading, isOwner, isPublic, memberCount, createRoom };
}
