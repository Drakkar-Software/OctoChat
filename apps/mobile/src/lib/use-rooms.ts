import { useCallback, useEffect, useMemo } from 'react';

import type { ObjectNode, Room, RoomKind } from '@/lib/types';

import { CategoryError, DEFAULT_CATEGORY } from './starfish/registry';
import {
  addObject,
  objectsToRoomCategories,
  patchObject,
  reparentObject,
  roomKindToSubtype,
  roomsToObjects,
} from './starfish/objects';
import { isPublicSpaceId } from './starfish/pubspace';
import { roomSlug } from './ids';
import { useObjects } from './use-objects';
import { useRoomsRegistry, useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useUnread } from './unread-context';

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

/**
 * Drop `kind: 'automated'` rooms from the category list — they belong to the
 * **Agents** view, not the **Chat** room list. A category that held only agents is
 * removed too; an already-empty category (a freshly-created, unfilled one) is kept.
 */
export function excludeAutomatedRooms(categories: RoomCategory[]): RoomCategory[] {
  return categories
    .map((c) => ({ ...c, rooms: c.rooms.filter((r) => r.kind !== 'automated') }))
    .filter((c, i) => c.rooms.length > 0 || categories[i].rooms.length === 0);
}

const CREATE_FAILED_MESSAGE = "Couldn't save the change. Please try again.";
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findCategory = (nodes: ObjectNode[], name: string) =>
  nodes.find((n) => n.type === 'category' && !n.archived && sameName(n.title, name));

/**
 * Rooms of a space, grouped by category, sourced from the unified OBJECT INDEX
 * ({@link useObjects}). Replaces the old `_rooms`-registry read: rooms + categories now
 * live in `objects/_index` (union-merged), so docs/projects and rooms share one model.
 * `_rooms` remains the owner/members ACCESS record (read via {@link useRoomsRegistry} for
 * ownership + as a fallback list until a space migrates). Public + private spaces unify
 * here — `useObjects` picks the right collection by space type.
 *
 * Per the design, ANY member may create rooms/categories (the index is `space:member`-
 * writable); ownership only governs the access record, not the object list.
 */
export function useRooms(spaceId: string | null) {
  const { session } = useSession();
  const { unreadByRoom } = useUnread();
  const sid = spaceId ?? '';
  const enabled = !!spaceId;

  // Access record (owner/members + legacy room list for the pre-migration fallback).
  const reg = useRoomsRegistry(spaceId);
  const { refresh } = useRoomsRegistryActions();
  const objects = useObjects(sid, { enabled });
  const { nodes, ready, mutate, seedIfEmpty } = objects;
  const publicSpace = !!spaceId && isPublicSpaceId(sid);

  // ── TEMP MIGRATION (remove once every space is on the object index) ──────────
  // Seed the unified index from a space's legacy `_rooms` rooms/categories the first
  // time we see the index empty but the registry populated. Idempotent (seedIfEmpty
  // no-ops once the index has anything), so it runs at most once per space and never
  // clobbers index-native rooms.
  //
  // The tail is CLOSED: `RoomsRegistryProvider.fetchEntry` now sources rooms/categories
  // from the index too (headless decrypt, with `_rooms` fallback), so every registry
  // consumer — room screen kind lookup, unread, push, automations — is served the SAME
  // index rooms. This hook reads the LIVE index for instant sidebar/tab updates and
  // `refresh()`es the provider after writes so those consumers converge.
  useEffect(() => {
    if (!enabled || !ready || !reg.loaded) return;
    const hasIndexRooms = nodes.some((n) => n.type === 'room' || n.type === 'category');
    if (hasIndexRooms || reg.rooms.length === 0) return;
    seedIfEmpty(roomsToObjects(reg.rooms, reg.categories, Date.now()));
    // Re-read the provider once the seed lands so the index-backed registry (room
    // screen kind, unread, push, automations) picks up the migrated rooms. Best-effort
    // + eventually-consistent: a too-early read just keeps the legacy fallback and the
    // next provider read converges.
    void refresh(sid);
  }, [enabled, ready, reg.loaded, reg.rooms, reg.categories, nodes, seedIfEmpty, refresh, sid]);

  // Room list: prefer the index projection; fall back to the legacy `_rooms` list while
  // a space hasn't migrated yet (index still empty), so chat shows rooms immediately.
  const categories = useMemo<RoomCategory[]>(() => {
    const fromIndex = objectsToRoomCategories(nodes, sid, DEFAULT_CATEGORY);
    const base: RoomCategory[] = fromIndex ?? legacyCategories(reg.rooms, reg.categories);
    // Overlay live unread counts so ChannelRow badges light up.
    return base.map((c) => ({ ...c, rooms: c.rooms.map((r) => ({ ...r, unread: unreadByRoom[r.id] ?? 0 })) }));
  }, [nodes, sid, reg.rooms, reg.categories, unreadByRoom]);

  const rooms = useMemo<Room[]>(() => categories.flatMap((c) => c.rooms), [categories]);

  const isOwner = !!session && reg.owner !== null && reg.owner === session.userId;
  const memberCount = publicSpace ? null : 1 + reg.members.length;

  // Map a failed index write to a user-facing message; CategoryError carries a friendly
  // validation message (duplicate/empty name). No owner gate — members may write.
  const run = useCallback(
    async (apply: () => boolean): Promise<string | null> => {
      try {
        if (!apply()) return CREATE_FAILED_MESSAGE; // false = store not writable yet
        // Converge the index-backed provider (room screen kind, unread, push, automations)
        // after the write flushes. The live `useObjects` list updates the sidebar/tab
        // instantly; this is the eventual re-read for the other consumers.
        void refresh(sid);
        return null;
      } catch (e) {
        if (e instanceof CategoryError) return e.message;
        return CREATE_FAILED_MESSAGE;
      }
    },
    [refresh, sid],
  );

  const createRoom = useCallback(
    (name: string, category: string = DEFAULT_CATEGORY, kind: RoomKind = 'channel'): Promise<string | null> => {
      const roomId = `${sid}-${roomSlug(name)}-${Date.now().toString(36)}`;
      return run(() =>
        mutate((cur, now) => {
          let next = cur;
          let catId = findCategory(next, category)?.id;
          if (!catId) {
            const r = addObject(next, { type: 'category', title: category }, now);
            next = r.nodes;
            catId = r.node.id;
          }
          return addObject(next, { type: 'room', id: roomId, subtype: roomKindToSubtype(kind), parentId: catId, title: name }, now).nodes;
        }),
      );
    },
    [run, mutate, sid],
  );

  const createCategory = useCallback(
    (name: string): Promise<string | null> => {
      const trimmed = name.trim();
      return run(() =>
        mutate((cur, now) => {
          if (!trimmed) throw new CategoryError('Enter a category name.');
          if (findCategory(cur, trimmed)) throw new CategoryError('A category with that name already exists.');
          return addObject(cur, { type: 'category', title: trimmed }, now).nodes;
        }),
      );
    },
    [run, mutate],
  );

  const renameCategory = useCallback(
    (oldName: string, newName: string): Promise<string | null> => {
      const next = newName.trim();
      return run(() =>
        mutate((cur, now) => {
          if (!next) throw new CategoryError('Enter a category name.');
          const cat = findCategory(cur, oldName);
          if (!cat || sameName(oldName, next)) return cur;
          if (findCategory(cur, next)) throw new CategoryError('A category with that name already exists.');
          return patchObject(cur, cat.id, { title: next }, now);
        }),
      );
    },
    [run, mutate],
  );

  const deleteCategory = useCallback(
    (name: string): Promise<string | null> =>
      run(() =>
        mutate((cur, now) => {
          const cat = findCategory(cur, name);
          if (!cat) return cur;
          // Reassign the category's rooms to the fallback bucket (ensure it exists),
          // then archive ONLY the category node (not its rooms — no cascade).
          let next = cur;
          let fallbackId = findCategory(next, DEFAULT_CATEGORY)?.id;
          if (!fallbackId || fallbackId === cat.id) {
            const r = addObject(next, { type: 'category', title: DEFAULT_CATEGORY }, now);
            next = r.nodes;
            fallbackId = r.node.id;
          }
          next = next.map((n) => (n.parentId === cat.id ? { ...n, parentId: fallbackId!, updatedAt: now } : n));
          return next.map((n) => (n.id === cat.id ? { ...n, archived: true, updatedAt: now } : n));
        }),
      ),
    [run, mutate],
  );

  const reorderCategories = useCallback(
    (order: string[]): Promise<string | null> =>
      run(() =>
        mutate((cur, now) => {
          const orderByName = new Map(order.map((name, i) => [name.toLowerCase(), i]));
          return cur.map((n) =>
            n.type === 'category' && orderByName.has(n.title.toLowerCase())
              ? { ...n, order: orderByName.get(n.title.toLowerCase())!, updatedAt: now }
              : n,
          );
        }),
      ),
    [run, mutate],
  );

  const moveRoom = useCallback(
    (roomId: string, category: string): Promise<string | null> =>
      run(() =>
        mutate((cur, now) => {
          let next = cur;
          let catId = findCategory(next, category)?.id;
          if (!catId) {
            const r = addObject(next, { type: 'category', title: category }, now);
            next = r.nodes;
            catId = r.node.id;
          }
          return reparentObject(next, roomId, catId, now);
        }),
      ),
    [run, mutate],
  );

  return {
    categories,
    rooms,
    loading: enabled && !ready && reg.loading && !reg.loaded,
    isOwner,
    isPublic: publicSpace,
    memberCount,
    createRoom,
    createCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    moveRoom,
  };
}

/** Pre-migration fallback: group the legacy `_rooms` rooms by their stored category
 *  order (the old behaviour) so chat still lists rooms before the index seeds. */
function legacyCategories(rooms: Room[], categoryNames: string[]): RoomCategory[] {
  const map = new Map<string, Room[]>();
  for (const name of categoryNames) map.set(name, []);
  for (const r of rooms) {
    if (!map.has(r.category)) map.set(r.category, []);
    map.get(r.category)!.push(r);
  }
  return [...map.entries()].map(([name, rs]) => ({ name, rooms: rs }));
}
