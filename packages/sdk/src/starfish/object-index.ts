/**
 * Headless (no-React) reads + create-time seeding of a space's unified OBJECT INDEX —
 * the PLAINTEXT `objects/_index` doc (enc:"none", see apps/server/src/config.ts) that,
 * since the `_rooms` slim, is the SOLE source of a space's room/category/automation list
 * (the `_rooms` / `_access` doc keeps only the owner/members access record + the shared
 * name/image). The reactive equivalent is {@link useObjects}; this module is what the
 * non-React consumers use: the rooms-registry provider's headless read, cross-room
 * search/threads/pins, space stats, notification labels, and the one-shot seed
 * `createSpace`/`createDmSpace` write at space creation.
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { getSpaceClient } from '@drakkar.software/octospaces-sdk';

import type { ObjectNode, Room } from '../domain/types';

import type { Session } from './identity';
import { DEFAULT_CATEGORY, objectsToRoomCategories, seedIndexNodes, type SeedRoom } from './objects';
import { objIndexPull, objIndexPush } from './paths';

/** Decode the `objects` array out of a (decrypted) index doc, tolerating a missing /
 *  malformed body (reads back as an empty index). */
function indexNodes(plain: Record<string, unknown>): ObjectNode[] {
  return Array.isArray((plain as { objects?: unknown }).objects) ? ((plain as { objects: ObjectNode[] }).objects) : [];
}

/**
 * Pull + (private: decrypt) + project a space's object index into the legacy
 * `{ rooms, categories }` shape every room-list consumer speaks. `encryptor` is null for
 * a PUBLIC space (plaintext index) and the space encryptor for a PRIVATE one. Returns
 * null on ANY failure or an empty index (no `room`/`category` nodes), so a caller can
 * degrade gracefully rather than render a blank list on a transient hiccup.
 */
export async function readIndexRooms(
  client: StarfishClient,
  encryptor: Encryptor | null,
  indexPath: string,
  spaceId: string,
): Promise<{ rooms: Room[]; categories: string[] } | null> {
  try {
    const res = await client.pull(indexPath).catch(() => null);
    if (!res?.data) return null;
    const plain = encryptor
      ? await encryptor.decrypt(res.data as Record<string, unknown>)
      : (res.data as Record<string, unknown>);
    const cats = objectsToRoomCategories(indexNodes(plain), spaceId, DEFAULT_CATEGORY);
    if (!cats) return null; // index holds no room/category nodes
    return { rooms: cats.flatMap((c) => c.rooms), categories: cats.map((c) => c.name) };
  } catch {
    return null;
  }
}

/**
 * SOFT read a PRIVATE space's index rooms for a read-only consumer: open the (cached)
 * space client and project the index. Returns `[]` when the index is empty/unreadable —
 * the caller treats that as "no rooms to scan". Public spaces are handled by their
 * callers' plaintext path.
 */
export async function readPrivateSpaceRooms(session: Session, spaceId: string): Promise<Room[]> {
  try {
    const client = getSpaceClient(spaceId, session);
    const idx = await readIndexRooms(client, null, objIndexPull(spaceId), spaceId);
    return idx?.rooms ?? [];
  } catch {
    return [];
  }
}

/**
 * Write the create-time seed into a space's plaintext index doc with an already-open
 * client — the DM path passes one from `ownerEnsureKeyring`, so it avoids re-opening.
 * Idempotent: a no-op if the index doc already exists (so a re-run never clobbers a
 * populated index).
 */
export async function pushIndexSeed(
  client: StarfishClient,
  spaceId: string,
  rooms: SeedRoom[],
): Promise<void> {
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  if (res?.data) return; // already seeded — never clobber
  // Shape matches `useObjects` (reads `doc.objects`): plaintext object array, no
  // encryption; the union-merge keys on each node's own id/updatedAt.
  const nodes: ObjectNode[] = seedIndexNodes(rooms, Date.now());
  await client.push(objIndexPush(spaceId), { objects: nodes } as Record<string, unknown>, res?.hash ?? null);
}

/**
 * Seed a brand-new space's index as the OWNER: obtain the member-gated space client
 * and push the plaintext seed nodes. Called from `createSpace` right after `_rooms`
 * claims ownership (so `space:owner` is satisfied for the index write). This is the
 * ONLY thing that seeds a freshly-created space's room list.
 */
export async function seedSpaceObjectIndex(session: Session, spaceId: string, rooms: SeedRoom[]): Promise<void> {
  const client = getSpaceClient(spaceId, session);
  await pushIndexSeed(client, spaceId, rooms);
}
