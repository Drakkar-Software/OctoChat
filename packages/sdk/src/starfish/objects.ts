/**
 * Unified Object model — pure logic over the space object index.
 *
 * Tree functions (buildTree, breadcrumbs, ancestors, subtreeIds, nextOrder,
 * addObject, patchObject, reparentObject, reorderObjects, archiveObject) are
 * re-exported from @drakkar.software/octospaces-sdk.
 *
 * OctoChat-specific adapters (objectsToRoomCategories, excludeAutomatedRooms,
 * seedIndexNodes, roomKindToSubtype, subtypeToRoomKind, channelNodeAccess,
 * categoryId, DEFAULT_CATEGORY) live below.
 */
import type { AutomationMeta, ID, ObjectNode, ObjectType, Room, RoomSubtype } from '../domain/types';
import type { NodeAccess } from '@drakkar.software/octospaces-sdk';
import {
  buildTree,
  breadcrumbs,
  ancestors,
  subtreeIds,
  nextOrder,
  reparentObject,
  reorderObjects,
  archiveObject,
} from '@drakkar.software/octospaces-sdk';
import type { ObjectTreeNode } from '@drakkar.software/octospaces-sdk';
import { randomId, roomSlug } from '../domain/ids';

// Re-export the tree primitives — identical to octospaces-sdk.
export type { ObjectTreeNode };
export { buildTree, breadcrumbs, ancestors, subtreeIds, nextOrder, reparentObject, reorderObjects, archiveObject };

// ── Node reducers (pure: ObjectNode[] → ObjectNode[]) ─────────────────────────
// addObject/patchObject/NewObjectInput stay local: OctoChat adds subtype/automation
// and preserves enc:false (SDK's addObject only sets enc when truthy).

/** OctoChat-extended input — adds `subtype` and `automation` to the SDK's base shape. */
export interface NewObjectInput {
  type: ObjectType;
  subtype?: RoomSubtype;
  parentId?: ID | null;
  title: string;
  emoji?: string;
  automation?: AutomationMeta;
  /** Provide to reuse an id (e.g. a room id derived elsewhere); else minted. */
  id?: ID;
  /** Per-node access tier. Absent ⇒ `'space'` (space-member default). */
  access?: NodeAccess;
  /** True when the node's content is E2EE under the space keyring. */
  enc?: boolean;
}

/** Append a new node under `parentId` at the end of its sibling order. */
export function addObject(nodes: ObjectNode[], input: NewObjectInput, now: number): { nodes: ObjectNode[]; node: ObjectNode } {
  const parentId = input.parentId ?? null;
  const siblings = nodes.filter((n) => n.parentId === parentId);
  const node: ObjectNode = {
    id: input.id ?? `obj-${randomId()}`,
    type: input.type,
    ...(input.subtype ? { subtype: input.subtype } : {}),
    parentId,
    order: nextOrder(siblings),
    title: input.title,
    ...(input.emoji ? { emoji: input.emoji } : {}),
    updatedAt: now,
    ...(input.automation ? { automation: input.automation } : {}),
    ...(input.access ? { access: input.access } : {}),
    ...(input.enc !== undefined ? { enc: input.enc } : {}),
  };
  return { nodes: [...nodes, node], node };
}

/** Patch a node's mutable metadata (title/emoji/automation), bumping `updatedAt`. */
export function patchObject(nodes: ObjectNode[], id: ID, patch: Partial<Pick<ObjectNode, 'title' | 'emoji' | 'automation'>>, now: number): ObjectNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now } : n));
}

/** The bucket new/unfiled rooms land in, and the fallback a deleted category's
 *  rooms are reassigned to. The seed category in `createSpace`/`createDmSpace`. Lives
 *  here (the cycle-free pure module) so both `registry` and the headless
 *  `object-index` seed/read helpers can share it without importing each other;
 *  `registry` re-exports it for its existing consumers. */
export const DEFAULT_CATEGORY = 'CHANNELS';

/** Deterministic category-node id from its name, so two devices that concurrently
 *  create (or auto-migrate) the SAME category mint the SAME id → the union-merge
 *  dedupes them instead of leaving duplicate category headers in the tree. (Random
 *  ids would not collide and both would survive the merge.) */
export const categoryId = (name: string): ID => `cat-${roomSlug(name) || randomId()}`;

/** Map a legacy {@link Room} `kind` to the unified room {@link RoomSubtype}. */
export function roomKindToSubtype(kind: Room['kind']): RoomSubtype {
  switch (kind) {
    case 'dm':
      return 'dm';
    case 'automated':
      return 'automation';
    default:
      return 'channel';
  }
}

/** Inverse of {@link roomKindToSubtype} — used while consumers still speak `RoomKind`.
 *  A legacy persisted `'stream'` subtype (rooms predate the stream↔channel merge) is
 *  NOT in {@link RoomSubtype} anymore, so it hits the `default` and reads back as a
 *  plain `'channel'` — which is exactly the normalization that retires `stream`. */
export function subtypeToRoomKind(subtype: RoomSubtype | undefined): Room['kind'] {
  switch (subtype) {
    case 'dm':
      return 'dm';
    case 'automation':
      return 'automated';
    default:
      return 'channel';
  }
}

// ── Adapter: unified index ↔ legacy room-list shape ───────────────────────────

/** The category→rooms grouping the chat UI consumes (mirrors `useRooms`'s output).
 *  Kept here so the projection FROM the unified index stays pure + testable. */
export interface AdaptedCategory {
  name: string;
  rooms: Room[];
}

/** Project the room/category nodes of an index into the legacy `{ name, rooms }[]`
 *  the existing chat UI (`RoomCategoryList`, `AgentsPanel`, room screen) consumes —
 *  so those components need NO change while rooms live in the unified index. Category
 *  nodes become buckets (ordered by their node order); room nodes become {@link Room}s
 *  grouped under their parent category (or `fallbackCategory` at root). Returns null
 *  when the index holds no room/category nodes yet, so a caller can fall back to the
 *  legacy `_rooms` list during migration. */
export function objectsToRoomCategories(nodes: ObjectNode[], spaceId: string, fallbackCategory: string): AdaptedCategory[] | null {
  const live = nodes.filter((n) => !n.archived);
  const sibCmp = (a: ObjectNode, b: ObjectNode) => a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const cats = live.filter((n) => n.type === 'category').slice().sort(sibCmp);
  const rooms = live.filter((n) => n.type === 'room');
  if (cats.length === 0 && rooms.length === 0) return null; // nothing migrated yet

  const titleById = new Map<ID, string>(cats.map((c) => [c.id, c.title]));
  const buckets = new Map<string, Room[]>();
  for (const c of cats) buckets.set(c.title, []);

  const toRoom = (n: ObjectNode, category: string): Room => ({
    id: n.id,
    spaceId,
    category,
    name: n.title,
    kind: subtypeToRoomKind(n.subtype),
    // Pass through per-node access flags so cross-room/stats can route stream paths.
    ...(n.access ? { access: n.access } : {}),
    // Default enc: space-member rooms (access absent or 'space') are E2EE (true);
    // public/invite rooms are plaintext (false). A stored value always overrides the default.
    enc: n.enc ?? (n.access === 'public' || n.access === 'invite' ? false : true),
    ...(n.automation ? { automation: n.automation } : {}),
  });

  // Stable room order within a bucket: by node order, then id.
  for (const n of rooms.slice().sort(sibCmp)) {
    const category = (n.parentId != null && titleById.get(n.parentId)) || fallbackCategory;
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category)!.push(toRoom(n, category));
  }
  return [...buckets.entries()].map(([name, rs]) => ({ name, rooms: rs }));
}

/**
 * Drop `kind: 'automated'` rooms from a category list — they belong to the **Agents**
 * view, not the **Chat** room list. A category that held only agents is removed too; an
 * already-empty category (a freshly-created, unfilled one) is kept. Pure projection over
 * {@link AdaptedCategory}, so the chat UI and any host can share the same filter.
 */
export function excludeAutomatedRooms(categories: AdaptedCategory[]): AdaptedCategory[] {
  return categories
    .map((c) => ({ ...c, rooms: c.rooms.filter((r) => r.kind !== 'automated') }))
    .filter((c, i) => c.rooms.length > 0 || categories[i].rooms.length === 0);
}

// ── Seed: build the initial index nodes for a freshly-created space ────────────

/** A minimal room descriptor the {@link seedIndexNodes} builder turns into nodes —
 *  the create-time seed (a space's `general` channel, a DM's single room). */
export interface SeedRoom {
  id: ID;
  name: string;
  kind: Room['kind'];
  category: string;
  /** Per-node access tier. Absent ⇒ `'space'` (space-member E2EE default). */
  access?: NodeAccess;
  /** True when the room's messages are E2EE under the space keyring. */
  enc?: boolean;
}

/**
 * Build the initial `ObjectNode[]` for a brand-new space's index: a `category` node
 * per distinct category and a `room` node per seed room parented under it. Pure +
 * deterministic (category ids via {@link categoryId}); the headless seed in
 * `object-index.ts` encrypts + pushes the result. Replaces the old `roomsToObjects`
 * migration builder now that every existing space has migrated and only NEW spaces
 * need seeding.
 */
/**
 * Node access/enc for a channel created via the Public / Private UI choice.
 * - Private (default) ⇒ space-member E2EE (`enc:true`, access absent = 'space').
 * - Public ⇒ world-readable plaintext (`access:'public'`, `enc:false`).
 *
 * Single source of truth — used by both the `createSpace` general-seed in
 * `registry.ts` and the app-level `createRoom` in `use-rooms.ts`.
 */
export function channelNodeAccess(isPublic: boolean): { access?: NodeAccess; enc: boolean } {
  return isPublic ? { access: 'public', enc: false } : { enc: true };
}

export function seedIndexNodes(rooms: SeedRoom[], now: number): ObjectNode[] {
  const out: ObjectNode[] = [];
  const catId = new Map<string, ID>();
  let catOrder = 0;
  for (const r of rooms) {
    if (catId.has(r.category)) continue;
    const id = categoryId(r.category);
    catId.set(r.category, id);
    out.push({ id, type: 'category', parentId: null, order: catOrder++, title: r.category, updatedAt: now });
  }
  const orderInCat = new Map<ID, number>();
  for (const r of rooms) {
    const parentId = catId.get(r.category)!;
    const order = (orderInCat.get(parentId) ?? 0) + 1;
    orderInCat.set(parentId, order);
    out.push({
      id: r.id, type: 'room', subtype: roomKindToSubtype(r.kind), parentId, order, title: r.name, updatedAt: now,
      ...(r.access ? { access: r.access } : {}),
      ...(r.enc !== undefined ? { enc: r.enc } : {}),
    });
  }
  return out;
}
