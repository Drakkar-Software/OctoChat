import { useCallback, useMemo } from 'react';

import type { Room, RoomKind } from '@/lib/types';

import {
  createCategory as createCategoryDoc,
  createRoom as createRoomDoc,
  CategoryError,
  deleteCategory as deleteCategoryDoc,
  moveRoom as moveRoomDoc,
  renameCategory as renameCategoryDoc,
  reorderCategories as reorderCategoriesDoc,
} from './starfish/registry';
import {
  createPublicCategory,
  createPublicRoom,
  deletePublicCategory,
  isPublicSpaceId,
  movePublicRoom,
  renamePublicCategory,
  reorderPublicCategories,
} from './starfish/pubspace';
import { useRoomsRegistry, useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useUnread } from './unread-context';

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

/** Adding a channel/category writes the `space:owner`-gated room registry, so only
 *  the owner may do it; a member is told to ask rather than the call rejecting. */
const NOT_OWNER_MESSAGE = 'Only the space owner can manage channels — ask the owner to do this.';
const CREATE_FAILED_MESSAGE = "Couldn't save the change. Please try again.";

/**
 * Rooms of a space, grouped by category, with owner-gated creator + management
 * actions. Thin consumer over {@link RoomsRegistryProvider}: the registry is fetched
 * once by the provider; this hook overlays live unread counts and shapes it for the UI.
 */
export function useRooms(spaceId: string | null) {
  const { session } = useSession();
  const { unreadByRoom } = useUnread();
  const { refresh } = useRoomsRegistryActions();
  const { rooms, owner, members, categories: categoryNames, loading, loaded } = useRoomsRegistry(spaceId);
  const isPublic = !!spaceId && isPublicSpaceId(spaceId);

  // Overlay live unread counts onto the registry rooms so `ChannelRow`'s Badge and
  // emphasis light up without the row components touching the provider.
  const roomsWithUnread = useMemo<Room[]>(
    () => rooms.map((r) => ({ ...r, unread: unreadByRoom[r.id] ?? 0 })),
    [rooms, unreadByRoom],
  );

  // Group by the registry's ORDERED category list (so empty + freshly-created
  // categories render, in their stored order), then append any room whose category
  // isn't listed (defensive — never drop a room).
  const categories = useMemo<RoomCategory[]>(() => {
    const map = new Map<string, Room[]>();
    for (const name of categoryNames) map.set(name, []);
    for (const r of roomsWithUnread) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return [...map.entries()].map(([name, rs]) => ({ name, rooms: rs }));
  }, [roomsWithUnread, categoryNames]);

  /** True when the signed-in identity owns this space (and so may add channels). */
  const isOwner = !!session && owner !== null && owner === session.userId;

  // Owner + roster, mirroring the space screen. Public spaces have no roster
  // (access is cap-based), so their count is unknown → null.
  const memberCount = isPublic ? null : 1 + members.length;

  // Every owner mutation funnels through here: gate on ownership (a member is told to
  // ask, not left with a rejected promise), run the public/private branch, refresh the
  // shared registry, and map failures to a user-facing message — CategoryError carries
  // a friendly validation message (e.g. duplicate name), a 403 means we aren't the
  // owner, anything else is an opaque save failure.
  const runOwnerAction = useCallback(
    async (fn: () => Promise<void>): Promise<string | null> => {
      if (!session || !spaceId) return null;
      if (owner !== null && owner !== session.userId) return NOT_OWNER_MESSAGE;
      try {
        await fn();
        await refresh(spaceId);
        return null;
      } catch (e) {
        if (e instanceof CategoryError) return e.message;
        if ((e as { status?: number })?.status === 403) return NOT_OWNER_MESSAGE;
        return CREATE_FAILED_MESSAGE;
      }
    },
    [session, spaceId, owner, refresh],
  );

  /**
   * Create a channel. Resolves to `null` on success, or a user-facing message to
   * surface when it can't — chiefly the owner-only registry write: a member is told
   * to ask the owner instead of the promise rejecting unhandled.
   */
  const createRoom = useCallback(
    (name: string, category?: string, kind: RoomKind = 'channel'): Promise<string | null> =>
      runOwnerAction(() =>
        isPublic && session && spaceId
          ? createPublicRoom(session, spaceId, name, category, kind).then(() => {})
          : createRoomDoc(session!.accountClient, session!.userId, spaceId!, name, category, kind).then(() => {}),
      ),
    [runOwnerAction, isPublic, session, spaceId],
  );

  const createCategory = useCallback(
    (name: string): Promise<string | null> =>
      runOwnerAction(() =>
        isPublic && session && spaceId
          ? createPublicCategory(session, spaceId, name)
          : createCategoryDoc(session!.accountClient, session!.userId, spaceId!, name),
      ),
    [runOwnerAction, isPublic, session, spaceId],
  );

  const renameCategory = useCallback(
    (oldName: string, newName: string): Promise<string | null> =>
      runOwnerAction(() =>
        isPublic && session && spaceId
          ? renamePublicCategory(session, spaceId, oldName, newName)
          : renameCategoryDoc(session!.accountClient, session!.userId, spaceId!, oldName, newName),
      ),
    [runOwnerAction, isPublic, session, spaceId],
  );

  const deleteCategory = useCallback(
    (name: string): Promise<string | null> =>
      runOwnerAction(() =>
        isPublic && session && spaceId
          ? deletePublicCategory(session, spaceId, name)
          : deleteCategoryDoc(session!.accountClient, session!.userId, spaceId!, name),
      ),
    [runOwnerAction, isPublic, session, spaceId],
  );

  const reorderCategories = useCallback(
    (order: string[]): Promise<string | null> =>
      runOwnerAction(() =>
        isPublic && session && spaceId
          ? reorderPublicCategories(session, spaceId, order)
          : reorderCategoriesDoc(session!.accountClient, session!.userId, spaceId!, order),
      ),
    [runOwnerAction, isPublic, session, spaceId],
  );

  const moveRoom = useCallback(
    (roomId: string, category: string): Promise<string | null> =>
      runOwnerAction(() =>
        isPublic && session && spaceId
          ? movePublicRoom(session, spaceId, roomId, category)
          : moveRoomDoc(session!.accountClient, session!.userId, spaceId!, roomId, category),
      ),
    [runOwnerAction, isPublic, session, spaceId],
  );

  // `loading` only while no cached entry exists yet; a null space is never loading.
  return {
    categories,
    rooms: roomsWithUnread,
    loading: !!spaceId && loading && !loaded,
    isOwner,
    isPublic,
    memberCount,
    createRoom,
    createCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    moveRoom,
  };
}
