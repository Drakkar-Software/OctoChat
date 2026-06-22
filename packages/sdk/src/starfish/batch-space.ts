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
 * Server collection names (apps/server/src/config.ts):
 *   spaceregistry → spaces/{spaceId}/_access
 *   objindex      → spaces/{spaceId}/objects/_index
 */
import { getSpaceClient, readSpaceAccess } from '@drakkar.software/octospaces-sdk';
import type { Session } from '@drakkar.software/octospaces-sdk';
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
  } catch {
    // Fallback: concurrent individual pulls (Phase 3c-1 approach).
    const [registry, idx] = await Promise.all([
      readSpaceAccess(client, spaceId),
      readIndexRooms(client, null, objIndexPull(spaceId), spaceId),
    ]);
    return { registry, index: idx };
  }
}
