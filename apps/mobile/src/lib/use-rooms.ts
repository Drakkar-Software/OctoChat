import { useCallback, useMemo } from 'react';

import type { Room } from '@/lib/types';

import { createRoom as createRoomDoc } from './starfish/registry';
import { createPublicRoom, isPublicSpaceId } from './starfish/pubspace';
import { useRoomsRegistry, useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useUnread } from './unread-context';

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

/** Adding a channel writes the `space:owner`-gated room registry, so only the
 *  owner may do it; a member is told to ask rather than the call rejecting. */
const NOT_OWNER_MESSAGE = 'Only the space owner can create channels — ask the owner to add this one.';
const CREATE_FAILED_MESSAGE = "Couldn't create the channel. Please try again.";

/**
 * Rooms of a space, grouped by category, with an owner-gated creator action. Thin
 * consumer over {@link RoomsRegistryProvider}: the registry is fetched once by the
 * provider; this hook overlays live unread counts and shapes it for the UI.
 */
export function useRooms(spaceId: string | null) {
  const { session } = useSession();
  const { unreadByRoom } = useUnread();
  const { refresh } = useRoomsRegistryActions();
  const { rooms, owner, members, loading, loaded } = useRoomsRegistry(spaceId);
  const isPublic = !!spaceId && isPublicSpaceId(spaceId);

  // Overlay live unread counts onto the registry rooms so `ChannelRow`'s Badge and
  // emphasis light up without the row components touching the provider.
  const roomsWithUnread = useMemo<Room[]>(
    () => rooms.map((r) => ({ ...r, unread: unreadByRoom[r.id] ?? 0 })),
    [rooms, unreadByRoom],
  );

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
   * Create a channel. Resolves to `null` on success, or a user-facing message to
   * surface when it can't — chiefly the owner-only registry write: a member is told
   * to ask the owner instead of the promise rejecting unhandled.
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
        await refresh(spaceId);
        return null;
      } catch (e) {
        // The registry write is owner-gated; a 403 means we aren't it.
        if ((e as { status?: number })?.status === 403) return NOT_OWNER_MESSAGE;
        return CREATE_FAILED_MESSAGE;
      }
    },
    [session, spaceId, owner, refresh],
  );

  // `loading` only while no cached entry exists yet; a null space is never loading.
  return { categories, rooms: roomsWithUnread, loading: !!spaceId && loading && !loaded, isOwner, isPublic, memberCount, createRoom };
}
