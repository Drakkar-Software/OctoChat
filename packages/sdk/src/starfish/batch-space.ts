/**
 * Batch fetch a space's `spaceregistry` (_access) and `objindex` (_index) in ONE
 * HTTP round-trip using `StarfishClient.batchPull`. Both collections are plaintext
 * and member-gated; the space client already has the required cap.
 *
 * Without batching, the registry fetches these as two SEQUENTIAL pulls per space:
 *   readSpaceAccess → _access (req 1) → then readIndexRooms → _index (req 2)
 *
 * `batchPullSpaceData` collapses them into a single `/batch/pull?collections=spaceregistry,objindex`
 * request, saving one network round-trip per space at cold load.
 *
 * The fallback to Phase 3c-1's parallel approach is retained: if `batchPull` fails
 * (e.g. the server version predates batch support), `readSpaceAccess` and
 * `readIndexRooms` are fired concurrently as the graceful degradation.
 *
 * `batchPullManySpaceData` extends this to MULTIPLE spaces in ONE request using the
 * broad-cap `session.spacesRegistryClient` (device cap, `paths: ["spaces/**", …]`),
 * which the server authorises per-entry by membership. This removes the former
 * "No cross-space batch" limitation.
 *
 * Server collection names (apps/server/src/config.ts):
 *   spaceregistry → spaces/{spaceId}/_access
 *   objindex      → spaces/{spaceId}/objects/_index
 *
 * ## Known batching limitations
 *
 * ### 1. Batch is not append/checkpoint-aware
 * `batchPull` cannot carry `last` / `since` / `appendField`, so the per-DM
 * `?last=1` head pulls (`dm-activity.ts:189`) cannot move to a batch request.
 * Those reads are eliminated at the call site (lazy trigger from `<DmList>`)
 * rather than batched.
 */
import { getSpaceClient, readSpaceAccess } from '@drakkar.software/starfish-spaces';
import type { Session } from '@drakkar.software/starfish-spaces';
import { StarfishHttpError } from '@drakkar.software/starfish-client';
import type { BatchPullEntry } from '@drakkar.software/starfish-client';
import type { ObjectNode } from '../domain/types';
import { readIndexRooms } from './object-index';
import { objIndexPull } from './paths';
import { objectsToRoomCategories, DEFAULT_CATEGORY } from './objects';

export interface SpaceRegistrySnapshot {
  owner: string | null;
  members: string[];
  name: string | null;
  image: string | null;
  hash: string | null;
}

export interface BatchSpaceDataResult {
  registry: SpaceRegistrySnapshot;
  /** null when the index is missing, empty, or unparseable. */
  index: { rooms: unknown[]; categories: string[] } | null;
}

function parseRegistry(entry: BatchPullEntry | undefined): SpaceRegistrySnapshot {
  const d = entry?.data as { owner?: unknown; members?: unknown; name?: unknown; image?: unknown } | undefined;
  return {
    owner: typeof d?.owner === 'string' ? d.owner : null,
    members: Array.isArray(d?.members) ? d!.members!.filter((m): m is string => typeof m === 'string') : [],
    name: typeof d?.name === 'string' ? d.name : null,
    image: typeof d?.image === 'string' ? d.image : null,
    hash: entry?.hash ?? null,
  };
}

function parseIndex(
  entry: BatchPullEntry | undefined,
  spaceId: string,
): { rooms: unknown[]; categories: string[] } | null {
  if (!entry?.data) return null;
  const objects = Array.isArray((entry.data as { objects?: unknown }).objects)
    ? ((entry.data as { objects: ObjectNode[] }).objects)
    : [];
  const cats = objectsToRoomCategories(objects, spaceId, DEFAULT_CATEGORY);
  if (!cats) return null;
  return { rooms: cats.flatMap((c) => c.rooms), categories: cats.map((c) => c.name) };
}

/**
 * Maximum number of spaces per cross-space `/batch/pull` chunk.
 *
 * The server's `max_collections_per_batch` defaults to 100 and counts TOTAL
 * param-set entries across all collections. We request two collections
 * (spaceregistry + objindex) × N spaces = 2N entries → cap at 50 spaces per
 * request to stay under the default 100-entry limit.
 */
const CROSS_SPACE_CHUNK_SIZE = 50;

/**
 * Pull a space's registry and object index in one batch request.
 *
 * Falls back to parallel individual pulls if `batchPull` is unavailable or fails
 * (e.g. server build without batch support).
 */
export async function batchPullSpaceData(
  session: Session,
  spaceId: string,
): Promise<BatchSpaceDataResult> {
  const client = getSpaceClient(spaceId, session);
  try {
    const result = await client.batchPull(['spaceregistry', 'objindex'], {
      params: {
        spaceregistry: [{ spaceId }],
        objindex: [{ spaceId }],
      },
    });
    return {
      registry: parseRegistry(result.collections['spaceregistry']?.[0]),
      index: parseIndex(result.collections['objindex']?.[0], spaceId),
    };
  } catch (err) {
    // 429: the server is rate-limiting. Do NOT fire the 2-pull fallback — that triples
    // the request count while the server is already overwhelmed. Rethrow so the registry
    // keeps its last-good cached entry and backs off naturally.
    if (err instanceof StarfishHttpError && err.status === 429) throw err;
    // Fallback: concurrent individual pulls (Phase 3c-1 approach, for servers without batch support).
    const [registry, idx] = await Promise.all([
      readSpaceAccess(client, spaceId, session),
      readIndexRooms(client, null, objIndexPull(spaceId), spaceId),
    ]);
    return { registry, index: idx };
  }
}

/**
 * Pull registry and object index for MANY spaces in as few HTTP round-trips as
 * possible.
 *
 * Uses `session.spacesRegistryClient` (device cap, `paths: ["spaces/**", …]`), which
 * the server authorises **per entry** by membership — each space in the result is only
 * present when the caller is a member of that space. Spaces that the server rejects
 * (non-member, absent _access) are silently omitted from the returned Map, consistent
 * with the single-space `batchPullSpaceData` fallback behaviour.
 *
 * Splits `spaceIds` into chunks of {@link CROSS_SPACE_CHUNK_SIZE} and issues one
 * `/batch/pull` per chunk concurrently, then merges the results. This stays safely
 * under the server's default 100-entry `max_collections_per_batch` limit (2 collections
 * × 50 spaces = 100 entries per request).
 *
 * On a non-429 error for a chunk, degrades gracefully to per-space
 * `batchPullSpaceData` calls (concurrent within the chunk). On 429, rethrows — adding
 * more requests on a rate-limited server would make things worse.
 */
export async function batchPullManySpaceData(
  session: Session,
  spaceIds: string[],
): Promise<Map<string, BatchSpaceDataResult>> {
  if (spaceIds.length === 0) return new Map();

  // Split into chunks ≤ CROSS_SPACE_CHUNK_SIZE.
  const chunks: string[][] = [];
  for (let i = 0; i < spaceIds.length; i += CROSS_SPACE_CHUNK_SIZE) {
    chunks.push(spaceIds.slice(i, i + CROSS_SPACE_CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(chunks.map((ids) => fetchChunk(session, ids)));

  const result = new Map<string, BatchSpaceDataResult>();
  for (const chunkMap of chunkResults) {
    for (const [id, entry] of chunkMap) {
      result.set(id, entry);
    }
  }
  return result;
}

/**
 * Pull `_access` records for MANY spaces in one HTTP round-trip.
 *
 * Uses the existing `spaceregistry` collection (compatible with the deployed Python
 * sync server) via `session.spacesRegistryClient.batchPullMany`. Only fetches
 * `_access` — no `_index` — so it's efficient for callers that only need the
 * roster/owner (e.g. the DM reconcile loops in `dm.ts`).
 *
 * Returns a `Map<spaceId, SpaceRegistrySnapshot>` with only the spaces the caller
 * is a member of. Spaces rejected by the server (non-member, absent) are silently
 * omitted.
 *
 * On a non-429 error, returns an empty `Map` (callers catch independently). On 429,
 * rethrows so the upstream cooldown/cache path can absorb it.
 */
export async function batchPullManySpaceAccess(
  session: Session,
  spaceIds: string[],
): Promise<Map<string, SpaceRegistrySnapshot>> {
  if (spaceIds.length === 0) return new Map();
  try {
    const entries = await session.spacesRegistryClient.batchPullMany(
      'spaceregistry',
      spaceIds.map((spaceId) => ({ spaceId })),
    );
    const result = new Map<string, SpaceRegistrySnapshot>();
    for (let i = 0; i < spaceIds.length; i++) {
      const entry = entries[i];
      if (!entry || entry.error) continue;
      result.set(spaceIds[i]!, parseRegistry(entry));
    }
    return result;
  } catch (err) {
    if (err instanceof StarfishHttpError && err.status === 429) throw err;
    return new Map();
  }
}

async function fetchChunk(
  session: Session,
  ids: string[],
): Promise<Map<string, BatchSpaceDataResult>> {
  try {
    const batchResult = await session.spacesRegistryClient.batchPull(
      ['spaceregistry', 'objindex'],
      {
        params: {
          spaceregistry: ids.map((spaceId) => ({ spaceId })),
          objindex: ids.map((spaceId) => ({ spaceId })),
        },
      },
    );
    const registryEntries = batchResult.collections['spaceregistry'] ?? [];
    const indexEntries = batchResult.collections['objindex'] ?? [];
    const map = new Map<string, BatchSpaceDataResult>();
    for (let i = 0; i < ids.length; i++) {
      const spaceId = ids[i]!;
      const regEntry = registryEntries[i];
      const idxEntry = indexEntries[i];
      // Skip spaces the server explicitly rejected (error entry, e.g. non-member).
      if (regEntry?.error) continue;
      map.set(spaceId, {
        registry: parseRegistry(regEntry),
        index: parseIndex(idxEntry, spaceId),
      });
    }
    return map;
  } catch (err) {
    // 429: do not amplify load — rethrow to the caller.
    if (err instanceof StarfishHttpError && err.status === 429) throw err;
    // Any other error (old server, network failure): degrade to per-space fallback.
    const entries = await Promise.all(
      ids.map(async (spaceId) => {
        try {
          return [spaceId, await batchPullSpaceData(session, spaceId)] as const;
        } catch {
          return null;
        }
      }),
    );
    const map = new Map<string, BatchSpaceDataResult>();
    for (const entry of entries) {
      if (entry) map.set(entry[0], entry[1]);
    }
    return map;
  }
}
