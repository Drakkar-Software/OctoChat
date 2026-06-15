import type { WriteEvent } from "@drakkar.software/starfish-protocol";
import type { Projection, ProjectionOp } from "@drakkar.software/starfish-projection";

/**
 * Public-space directory projection.
 *
 * The `starfish-projection` plugin folds every write of a watched `source`
 * collection into a single queryable *list document*. This one indexes spaces that
 * contain at least one PUBLIC room: on each write to a space's `objindex` it
 * upserts that space's `{ publicRooms, ts }` into the list at `_index/spaces/public`,
 * or removes the entry when the space has no public rooms. Clients pull that one
 * document to browse the directory (see the Explore screen + `spaceindex` collection
 * in config.ts). Space names + images are fetched separately from `_access` by the
 * client (same pattern as owner-profile resolution — the index is minimal, details
 * on demand).
 *
 * Source is `objindex` (always plaintext in the per-node access model): the
 * `objects[]` array carries `access='public'` flags readable without decryption,
 * so the projection can count public rooms from the write body alone.
 *
 * Keep in sync with drakkar_sync/apps/octospaces/projections.py.
 */

/** Count live public room nodes in an `objindex` write body's `objects` array. */
export function countPublicRooms(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const objects = (body as Record<string, unknown>).objects;
  if (!Array.isArray(objects)) return 0;
  return objects.filter(
    (n: unknown) =>
      n &&
      typeof n === "object" &&
      (n as Record<string, unknown>).type === "room" &&
      (n as Record<string, unknown>).access === "public" &&
      !(n as Record<string, unknown>).archived,
  ).length;
}

/** Map an `objindex` write to a directory upsert (or remove / ignore). */
export function projectObjIndex(e: WriteEvent): ProjectionOp {
  const spaceId = e.params.spaceId;
  if (!spaceId) return null;
  const publicRooms = countPublicRooms(e.body);
  if (publicRooms === 0) return { id: spaceId, remove: true };
  return {
    id: spaceId,
    value: { publicRooms, ts: e.timestamp },
  };
}

/**
 * Space name/image — populated by `spaceregistry` (i.e. `_access`) writes.
 *
 * IMPORTANT: targets the same `_index/spaces/public` shard as {@link projectObjIndex},
 * NOT a separate meta shard. The two projections union-merge into the same list doc:
 *
 *   `projectObjIndex`    → adds `{ publicRooms, ts }` for spaces with public rooms;
 *                          emits `remove: true` when the count drops to zero.
 *   `projectSpaceRegistry` → adds `{ name, image }` for any space name/image write.
 *
 * Because `loadPublicSpaceIndex` (explore-spaces.ts) filters entries by `publicRooms > 0`,
 * name/image entries without a corresponding publicRooms value are silently dropped by the
 * client — private spaces whose names land here (from a spaceregistry write with no
 * subsequent objindex write removing them) will NOT appear in the Explore screen. This is
 * preferable to a separate `_index/spaces/meta` shard, which would make ALL space names
 * publicly enumerable.
 *
 * Residual: a name/image entry for a private space can transiently exist in the raw list
 * doc until the next `objindex` write for that space fires `remove: true`. Acceptable for
 * the POC — the Explore UI stays clean, and the raw doc exposure is bounded.
 */
export function projectSpaceRegistry(e: WriteEvent): ProjectionOp {
  const spaceId = e.params.spaceId;
  if (!spaceId) return null;
  const body = e.body as Record<string, unknown> | undefined;
  const name = typeof body?.name === "string" ? body.name : null;
  const image = typeof body?.image === "string" ? body.image : null;
  return { id: spaceId, value: { name, image } };
}

/** The projections this server maintains. Passed to `createProjectionServerPlugin`. */
export const projections: Projection[] = [
  {
    source: "objindex",
    target: "_index/spaces/public",
    project: projectObjIndex,
  },
  {
    // Same target as above: name/image folds into the public directory so private-space
    // names are never published to a separate publicly-readable shard. Entries without
    // publicRooms > 0 are filtered client-side by loadPublicSpaceIndex.
    source: "spaceregistry",
    target: "_index/spaces/public",
    project: projectSpaceRegistry,
  },
];
