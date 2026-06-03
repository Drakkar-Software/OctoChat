/**
 * Unified Object model — pure logic over the space object index.
 *
 * A space's contents (rooms, categories, automations, docs, projects) are
 * {@link ObjectNode}s in one union-merged index doc at `spaces/{spaceId}/objects/_index`.
 * Encrypted I/O lives in the hook layer (`use-objects.ts` drives `useSyncInit` with the
 * space encryptor, exactly like `use-room.ts`); THIS module is the pure, testable core:
 * the tree builder + its merge-artifact guards, breadcrumbs, ordering, and the node
 * reducers a `store.set` applies. Keeping it side-effect-free is the twin of how
 * `reactions.ts` builds append-only events for the merge-doc room store.
 *
 * Because the index is union-merged (per-node last-write-wins keyed on `updatedAt`),
 * the tree is only eventually consistent — two devices can concurrently produce a
 * cycle (A→under B while B→under A) or an orphan (parent archived). The builder below
 * is the single place those are repaired so every consumer renders a well-formed tree.
 */
import type { AutomationMeta, ID, ObjectNode, ObjectType, Room, RoomSubtype } from '@/lib/types';
import { randomId, roomSlug } from '../ids';

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

/** A node plus its resolved children — the shape the sidebar/Work tree renders. */
export interface ObjectTreeNode extends ObjectNode {
  depth: number;
  children: ObjectTreeNode[];
}

/** Map a legacy {@link Room} `kind` to the unified room {@link RoomSubtype}. */
export function roomKindToSubtype(kind: Room['kind']): RoomSubtype {
  switch (kind) {
    case 'dm':
      return 'dm';
    case 'stream':
      return 'stream';
    case 'automated':
      return 'automation';
    default:
      return 'channel'; // 'channel' | 'private'
  }
}

/** Inverse of {@link roomKindToSubtype} — used while consumers still speak `RoomKind`. */
export function subtypeToRoomKind(subtype: RoomSubtype | undefined): Room['kind'] {
  switch (subtype) {
    case 'dm':
      return 'dm';
    case 'stream':
      return 'stream';
    case 'automation':
      return 'automated';
    default:
      return 'channel';
  }
}

/** Deterministic sibling comparison: by `order`, ties broken by `id`, so every device
 *  renders an identical tree regardless of merge arrival order. */
function compareSiblings(a: ObjectNode, b: ObjectNode): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The order value for a new node appended after `siblings` (max + 1, gap-free enough
 *  for drag-reorder which rewrites the moved node's order between neighbours). */
export function nextOrder(siblings: ObjectNode[]): number {
  let max = 0;
  for (const s of siblings) if (s.order > max) max = s.order;
  return max + 1;
}

/**
 * Build the render tree from a flat node list, repairing merge artifacts:
 *  - **archived** nodes (and, transitively, their subtrees) are dropped.
 *  - **orphans** — a `parentId` that is missing or archived — reparent to root.
 *  - **cycles** — a node reachable from itself via `parentId` — the offending node
 *    reparents to root (its later edit is the one broken; root is always safe).
 *  - **siblings** sort by {@link compareSiblings} for cross-device determinism.
 *
 * Pass `includeArchived` to keep archived nodes (e.g. an "archived" view).
 */
export function buildTree(nodes: ObjectNode[], includeArchived = false): ObjectTreeNode[] {
  const live = includeArchived ? nodes : nodes.filter((n) => !n.archived);
  const byId = new Map<ID, ObjectNode>(live.map((n) => [n.id, n]));

  // Resolve each node's EFFECTIVE parent: null if the parent is gone, or if following
  // the chain loops back to this node (cycle) — both fall to root.
  const effectiveParent = (n: ObjectNode): ID | null => {
    if (n.parentId == null) return null;
    if (!byId.has(n.parentId)) return null; // orphan → root
    const seen = new Set<ID>([n.id]);
    let cur: ID | null = n.parentId;
    while (cur != null) {
      if (seen.has(cur)) return null; // cycle → root
      seen.add(cur);
      const parent = byId.get(cur);
      if (!parent) return null;
      cur = parent.parentId;
    }
    return n.parentId;
  };

  const childrenOf = new Map<ID | null, ObjectNode[]>();
  for (const n of live) {
    const p = effectiveParent(n);
    const bucket = childrenOf.get(p) ?? [];
    bucket.push(n);
    childrenOf.set(p, bucket);
  }

  const attach = (parent: ID | null, depth: number): ObjectTreeNode[] =>
    (childrenOf.get(parent) ?? [])
      .slice()
      .sort(compareSiblings)
      .map((n) => ({ ...n, depth, children: attach(n.id, depth + 1) }));

  return attach(null, 0);
}

/** The root→node trail (inclusive) for breadcrumbs, following effective parents and
 *  short-circuiting any cycle. Returns `[]` if the node is unknown. */
export function breadcrumbs(nodes: ObjectNode[], id: ID): ObjectNode[] {
  const byId = new Map<ID, ObjectNode>(nodes.map((n) => [n.id, n]));
  const trail: ObjectNode[] = [];
  const seen = new Set<ID>();
  let cur: ID | null = id;
  while (cur != null && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const node: ObjectNode = byId.get(cur)!;
    trail.unshift(node);
    cur = node.parentId;
  }
  return trail;
}

/** The root→parent trail (EXCLUSIVE of the node itself) — the ancestor path a
 *  breadcrumb shows, since the current node is already titled on its own screen.
 *  Empty for a root-level node. */
export function ancestors(nodes: ObjectNode[], id: ID): ObjectNode[] {
  return breadcrumbs(nodes, id).slice(0, -1);
}

/** The ids of a node and its whole subtree (for cascade-archive). */
export function subtreeIds(nodes: ObjectNode[], rootId: ID): Set<ID> {
  const childrenOf = new Map<ID | null, ID[]>();
  for (const n of nodes) {
    const bucket = childrenOf.get(n.parentId) ?? [];
    bucket.push(n.id);
    childrenOf.set(n.parentId, bucket);
  }
  const out = new Set<ID>();
  const walk = (id: ID) => {
    if (out.has(id)) return; // guard against a cyclic parentId
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return out;
}

// ── Node reducers (pure: ObjectNode[] → ObjectNode[]) ─────────────────────────
// A `store.set` applies one of these to the index doc's `objects` array. `now` is
// threaded in (never `Date.now()` inline) so callers stamp a single consistent
// timestamp and the reducers stay pure/testable.

export interface NewObjectInput {
  type: ObjectType;
  subtype?: RoomSubtype;
  parentId?: ID | null;
  title: string;
  emoji?: string;
  automation?: AutomationMeta;
  /** Provide to reuse an id (e.g. a room id derived elsewhere); else minted. */
  id?: ID;
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
  };
  return { nodes: [...nodes, node], node };
}

/** Patch a node's mutable metadata (title/emoji/automation), bumping `updatedAt`. */
export function patchObject(nodes: ObjectNode[], id: ID, patch: Partial<Pick<ObjectNode, 'title' | 'emoji' | 'automation'>>, now: number): ObjectNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now } : n));
}

/** Reparent a node (move in the tree). Rejects making a node its own descendant —
 *  the caller's drop target is ignored in that case and the list returned unchanged. */
export function reparentObject(nodes: ObjectNode[], id: ID, parentId: ID | null, now: number): ObjectNode[] {
  if (id === parentId) return nodes;
  if (parentId != null && subtreeIds(nodes, id).has(parentId)) return nodes; // would create a cycle
  const siblings = nodes.filter((n) => n.parentId === parentId && n.id !== id);
  return nodes.map((n) => (n.id === id ? { ...n, parentId, order: nextOrder(siblings), updatedAt: now } : n));
}

/** Set explicit sibling order (drag-reorder); ids not present are left untouched. */
export function reorderObjects(nodes: ObjectNode[], orderById: Record<ID, number>, now: number): ObjectNode[] {
  return nodes.map((n) => (n.id in orderById ? { ...n, order: orderById[n.id]!, updatedAt: now } : n));
}

/** Cascade-archive a node and its whole subtree (soft delete). */
export function archiveObject(nodes: ObjectNode[], id: ID, now: number): ObjectNode[] {
  const ids = subtreeIds(nodes, id);
  return nodes.map((n) => (ids.has(n.id) ? { ...n, archived: true, updatedAt: now } : n));
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
  const cats = live.filter((n) => n.type === 'category').slice().sort(compareSiblings);
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
    ...(n.automation ? { automation: n.automation } : {}),
  });

  // Stable room order within a bucket: by node order, then id.
  for (const n of rooms.slice().sort(compareSiblings)) {
    const category = (n.parentId != null && titleById.get(n.parentId)) || fallbackCategory;
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category)!.push(toRoom(n, category));
  }
  return [...buckets.entries()].map(([name, rs]) => ({ name, rooms: rs }));
}

// ── Seed: build the initial index nodes for a freshly-created space ────────────

/** A minimal room descriptor the {@link seedIndexNodes} builder turns into nodes —
 *  the create-time seed (a space's `general` channel, a DM's single room). */
export interface SeedRoom {
  id: ID;
  name: string;
  kind: Room['kind'];
  category: string;
}

/**
 * Build the initial `ObjectNode[]` for a brand-new space's index: a `category` node
 * per distinct category and a `room` node per seed room parented under it. Pure +
 * deterministic (category ids via {@link categoryId}); the headless seed in
 * `object-index.ts` encrypts + pushes the result. Replaces the old `roomsToObjects`
 * migration builder now that every existing space has migrated and only NEW spaces
 * need seeding.
 */
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
    out.push({ id: r.id, type: 'room', subtype: roomKindToSubtype(r.kind), parentId, order, title: r.name, updatedAt: now });
  }
  return out;
}
