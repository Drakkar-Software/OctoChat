import type { WriteEvent } from "@drakkar.software/starfish-protocol";
import type { Projection, ProjectionOp } from "@drakkar.software/starfish-projection";

/**
 * Public-space directory projection.
 *
 * The `starfish-projection` plugin folds every write of a watched `source`
 * collection into a single queryable *list document*. This one indexes PUBLIC
 * spaces: on each write to a public space's `_rooms` registry it upserts that
 * space's `{ name, ownerId, image, rooms }` into the list at `_index/spaces/public`.
 * Clients pull that one document to browse the directory (see the Explore screen +
 * `_index/spaces/public` collection in config.ts).
 *
 * Sharded by space TYPE via the `target` function (the "shard by type" design):
 * only the PUBLIC shard is materialized. Private spaces are deliberately NOT
 * indexed — their `_rooms` doc is read-gated per-space (`space:member`), and an
 * aggregate index doc has a single read-role, so a client-readable private shard
 * would leak every private space's name/owner/roster and break the invite-only
 * E2EE model. A future admin-only private shard would extend `spaceTarget` with a
 * `_index/spaces/private` branch gated behind an admin read-role; out of scope here.
 *
 * Space type is IMMUTABLE (a space never converts public↔private), so the
 * projection's "shard by an immutable key" rule holds — no stale-shard footgun.
 */

/** The list document a `pubspace` write routes into: always the public shard. */
function spaceTarget(_event: WriteEvent): string | null {
  // source is `pubspace` (inherently public) → the public shard. Extension point:
  // a `rooms` source would branch to a `_index/spaces/private` admin-only shard.
  return "_index/spaces/public";
}

/** Map a `pubspace` `_rooms` write to a directory entry (or ignore non-registry writes). */
function projectPubspace(e: WriteEvent): ProjectionOp {
  // The `pubspace` collection's `{docId}` is the room registry (`_rooms`) OR a
  // per-room message doc. Index ONLY the `_rooms` registry — without this filter
  // the entry `value` would be message bodies, not the space's metadata.
  if (e.params.docId !== "_rooms") return null;
  const body = e.body ?? {};
  return {
    id: e.params.spaceId,
    value: {
      name: typeof body.name === "string" ? body.name : null,
      // `pubspace` path is `pubspaces/{ownerId}/{spaceId}/{docId}` — owner is a path param.
      ownerId: e.params.ownerId ?? null,
      image: typeof body.image === "string" ? body.image : null,
      rooms: Array.isArray(body.rooms) ? body.rooms.length : 0,
      ts: e.timestamp,
    },
  };
  // Note: upsert-only. Public-space deletion has no tombstone flow today; when one
  // exists, recognise it here and return `{ id: e.params.spaceId, remove: true }`.
}

/** The projections this server maintains. Passed to `createProjectionServerPlugin`. */
export const projections: Projection[] = [
  {
    source: "pubspace",
    target: spaceTarget,
    project: projectPubspace,
  },
];
