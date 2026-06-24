import { useCallback, useMemo } from 'react';

import type { ObjectNode, Room, RoomKind } from '@drakkar.software/octochat-sdk';

import { CategoryError } from '@drakkar.software/octochat-sdk';
import {
  addObject,
  categoryId,
  channelNodeAccess,
  DEFAULT_CATEGORY,
  objectsToRoomCategories,
  patchObject,
  reparentObject,
  roomKindToSubtype,
} from '@drakkar.software/octochat-sdk';
import { roomSlug } from '@drakkar.software/octochat-sdk';
import { useObjects } from './use-objects';
import { useRoomsRegistry, useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useUnreadCounts } from './unread-context';

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

/** UserIds of the auto-provisioned bots enrolled as roster members of a space's PRIVATE
 *  automations (one per automated room — see the SDK `provisionPrivateBot`). Subtracted from the
 *  member roster everywhere it's displayed so a bot doesn't show as a phantom, profile-less
 *  member. Empty for public spaces (their bots never join the roster). */
export function automationBotUserIds(rooms: Room[]): string[] {
  return rooms.flatMap((r) => (r.kind === 'automated' && r.automation?.botUserId ? [r.automation.botUserId] : []));
}

// `excludeAutomatedRooms` (the Agents/Chat split filter) moved to the SDK — re-exported
// here so existing `import { excludeAutomatedRooms } from '@/lib/use-rooms'` call sites
// (the rooms screen + desktop sidebar) keep working. `RoomCategory` is structurally the
// SDK's `AdaptedCategory`, so passing it through type-checks.
export { excludeAutomatedRooms } from '@drakkar.software/octochat-sdk';

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
  const { unreadByRoom } = useUnreadCounts();
  const sid = spaceId ?? '';
  const enabled = !!spaceId;

  // Access record (owner/members + legacy room list for the pre-migration fallback).
  const reg = useRoomsRegistry(spaceId);
  const { refresh } = useRoomsRegistryActions();
  const objects = useObjects(sid, { enabled });
  const { nodes, ready, mutate, pull: pullObjects } = objects;

  // Room list, sourced from the unified OBJECT INDEX (the sole source now that `_rooms`
  // is just the access record). An empty/opening index yields an empty list — the
  // sidebar shows its loading state until `ready`, then the projected rooms.
  const categories = useMemo<RoomCategory[]>(() => {
    const base = objectsToRoomCategories(nodes, sid, DEFAULT_CATEGORY) ?? [];
    // Overlay live unread counts so ChannelRow badges light up.
    return base.map((c) => ({ ...c, rooms: c.rooms.map((r) => ({ ...r, unread: unreadByRoom[r.id] ?? 0 })) }));
  }, [nodes, sid, unreadByRoom]);

  const rooms = useMemo<Room[]>(() => categories.flatMap((c) => c.rooms), [categories]);

  const isOwner = !!session && reg.owner !== null && reg.owner === session.userId;
  // Exclude automation bots (real roster members in private spaces) from the human count.
  const memberCount = useMemo(() => {
    const bots = new Set(automationBotUserIds(rooms));
    return 1 + reg.members.filter((id) => !bots.has(id)).length;
  }, [reg.members, rooms]);

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
    (name: string, category: string = DEFAULT_CATEGORY, opts: { isPublic?: boolean } = {}): Promise<string | null> => {
      const roomId = `${sid}-${roomSlug(name)}-${Date.now().toString(36)}`;
      return run(() =>
        mutate((cur, now) => {
          let next = cur;
          let catId = findCategory(next, category)?.id;
          if (!catId) {
            const r = addObject(next, { type: 'category', id: categoryId(category), title: category }, now);
            next = r.nodes;
            catId = r.node.id;
          }
          return addObject(
            next,
            { type: 'room', id: roomId, subtype: roomKindToSubtype('channel'), parentId: catId, title: name, ...channelNodeAccess(!!opts.isPublic) },
            now,
          ).nodes;
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
          return addObject(cur, { type: 'category', id: categoryId(trimmed), title: trimmed }, now).nodes;
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
            const r = addObject(next, { type: 'category', id: categoryId(DEFAULT_CATEGORY), title: DEFAULT_CATEGORY }, now);
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

  // Re-pull the object index from the server — for surfaces that mutate it through a
  // HEADLESS path that bypasses this hook's `mutate` store (e.g. an automation create via
  // the SDK), so the live room list repaints in-session instead of waiting for a reload.
  const reload = useCallback(() => pullObjects(), [pullObjects]);

  const moveRoom = useCallback(
    (roomId: string, category: string): Promise<string | null> =>
      run(() =>
        mutate((cur, now) => {
          let next = cur;
          let catId = findCategory(next, category)?.id;
          if (!catId) {
            const r = addObject(next, { type: 'category', id: categoryId(category), title: category }, now);
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
    memberCount,
    createRoom,
    createCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    moveRoom,
    reload,
  };
}
