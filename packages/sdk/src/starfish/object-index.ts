/**
 * Headless (no-React) reads + create-time seeding of a space's unified OBJECT INDEX —
 * the encrypted `objects/_index` doc that, since the `_rooms` slim, is the SOLE source
 * of a space's room/category list (the `_rooms` doc keeps only the owner/members access
 * record + the shared name/image). The reactive equivalent is {@link useObjects}; this
 * module is what the non-React consumers use: the rooms-registry provider's headless
 * decrypt, cross-room search/threads/pins, space stats, notification labels, and the
 * one-shot seed `createSpace`/`createDmSpace` write at space creation.
 */
import { ConflictError } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { ObjectNode, Room } from '../domain/types';

import type { Session } from './identity';
import { DEFAULT_CATEGORY, objectsToRoomCategories, seedIndexNodes, type SeedRoom } from './objects';
import { objIndexPull, objIndexPush, pubObjIndexPull } from './paths';
import { buildSpaceEncryptor, getSpaceEncryptor } from './space-encryptor';

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
 * Read a PUBLIC space's index rooms (plaintext — no encryptor) given a known owner id.
 * The public twin of {@link readPrivateIndexRooms}, used by the headless automation runner
 * (`conductor-init`) to enumerate `kind:'automated'` rooms from the unified index — where
 * they now live, instead of the legacy `_rooms` list. Returns `[]` on any failure / empty
 * index, so the runner simply schedules nothing rather than throwing.
 */
export async function readPublicIndexRooms(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<Room[]> {
  const idx = await readIndexRooms(client, null, pubObjIndexPull(ownerId, spaceId), spaceId);
  return idx?.rooms ?? [];
}

/**
 * Read a PRIVATE space's index rooms + categories given a KNOWN owner/members access
 * record (from the `_rooms` doc) — the registry provider's primary read. Opens the
 * (cached) space encryptor seeded with that access record, then projects the index.
 *
 * Skipped when the owner is unknown (unreadable/legacy registry): `getSpaceEncryptor`
 * treats a null owner as self and could MINT a keyring as a side effect of this passive
 * read — so we only attempt the index read once the access record names an owner. Returns
 * null on a null owner OR any failure (not a recipient yet / unreachable), so the caller
 * falls back to an empty list rather than rendering a blank room screen on a hiccup.
 *
 * Differs from {@link readPrivateSpaceRooms}: that one self-discovers the encryptor via
 * `buildSpaceEncryptor` (no owner/members) and returns just `Room[]`; this one takes the
 * already-read access record and also returns the ordered `categories`.
 */
export async function readPrivateIndexRooms(
  session: Session,
  spaceId: string,
  owner: string | null,
  members: string[],
): Promise<{ rooms: Room[]; categories: string[] } | null> {
  if (owner === null) return null;
  try {
    const { encryptor, client } = await getSpaceEncryptor(spaceId, session, { owner, members });
    return await readIndexRooms(client, encryptor, objIndexPull(spaceId), spaceId);
  } catch {
    return null; // not a recipient yet / unreachable → legacy fallback
  }
}

/**
 * SOFT read a PRIVATE space's index rooms for a read-only consumer: open the (cached)
 * space encryptor without minting a keyring (see {@link buildSpaceEncryptor}) and project
 * the index. Returns `[]` when the keyring isn't on this device yet (never opened) or the
 * index is empty/unreadable — the caller treats that as "no rooms to scan", same as the
 * old `readRooms` fallback did. Public spaces are handled by their callers' plaintext path.
 */
export async function readPrivateSpaceRooms(session: Session, spaceId: string): Promise<Room[]> {
  const space = await buildSpaceEncryptor(session, spaceId).catch(() => null);
  if (!space) return [];
  const idx = await readIndexRooms(space.client, space.enc, objIndexPull(spaceId), spaceId);
  return idx?.rooms ?? [];
}

/**
 * Write the create-time seed into a space's index doc with an already-open encryptor —
 * the DM path holds one from `ownerEnsureKeyring`, so it avoids re-opening. Idempotent:
 * a no-op if the index doc already exists (so a re-run never clobbers a populated index).
 */
export async function pushIndexSeed(
  client: StarfishClient,
  encryptor: Encryptor,
  spaceId: string,
  rooms: SeedRoom[],
): Promise<void> {
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  if (res?.data && (res.data as Record<string, unknown>)._encrypted) return; // already seeded
  // Shape matches `useObjects` (reads `doc.objects`): a bare sealed body, no top-level
  // timestamp; the union-merge keys on each node's own id/updatedAt, so no doc-level
  // stamp is needed.
  const sealed = await encryptor.encrypt({ objects: seedIndexNodes(rooms, Date.now()) });
  await client.push(objIndexPush(spaceId), sealed as Record<string, unknown>, res?.hash ?? null);
}

/**
 * Seed a brand-new PRIVATE space's index as the OWNER: open (minting, if needed) the
 * space keyring and push the encrypted seed nodes. Called from `createSpace` right after
 * `_rooms` claims ownership (so `space:owner` is satisfied for the keyring + index write).
 * This is what replaced the old on-device `_rooms`→index migration: with the migration
 * gone, this is the ONLY thing that seeds a freshly-created space's room list.
 */
export async function seedSpaceObjectIndex(session: Session, spaceId: string, rooms: SeedRoom[]): Promise<void> {
  const { encryptor, client } = await getSpaceEncryptor(spaceId, session, { owner: session.userId, members: [] });
  await pushIndexSeed(client, encryptor, spaceId, rooms);
}

/**
 * Headless read-modify-write of a space's unified OBJECT INDEX, factored out of
 * {@link updatePublicObjectIndex} so the PUBLIC (plaintext) and PRIVATE (E2EE) index
 * writers share ONE bounded conflict-retry loop. `encryptor` is null for a public index
 * (plaintext body) and the space encryptor for a private one — the only difference between
 * the two is the resolved `{client, encryptor, paths}`. The index is a hash-checked
 * union-merge doc, so a 409 re-reads FRESH state and re-runs the mutator, never clobbering
 * a sibling device's concurrently-added node. The mutator returns the next `objects` array,
 * or `null` to no-op.
 */
export async function updateObjectIndex(
  client: StarfishClient,
  encryptor: Encryptor | null,
  pullPath: string,
  pushPath: string,
  mutator: (nodes: ObjectNode[], now: number) => ObjectNode[] | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await client.pull(pullPath).catch(() => null);
    const plain = res?.data
      ? encryptor
        ? await encryptor.decrypt(res.data as Record<string, unknown>)
        : (res.data as Record<string, unknown>)
      : null;
    const cur = Array.isArray((plain as { objects?: unknown } | null)?.objects)
      ? (plain as { objects: ObjectNode[] }).objects
      : [];
    const next = mutator(cur, Date.now());
    if (!next) return;
    const body = encryptor ? await encryptor.encrypt({ objects: next }) : { objects: next };
    try {
      await client.push(pushPath, body as Record<string, unknown>, res?.hash ?? null);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * PRIVATE twin of {@link updatePublicObjectIndex}: headless RMW of an OWNED private space's
 * encrypted `objects/_index`. Opens the (cached) owner space encryptor and routes through the
 * shared {@link updateObjectIndex} loop. Owner-only — `getSpaceEncryptor` with our own userId
 * as the registry owner resolves the owner keyring (existing keyring → open; absent → mint),
 * which is exactly the authority an owner-run automation's index write needs. Used by the
 * automation registry mutators ({@link ../automations/registry-write}) for private spaces.
 */
export async function updatePrivateObjectIndex(
  session: Session,
  spaceId: string,
  mutator: (nodes: ObjectNode[], now: number) => ObjectNode[] | null,
): Promise<void> {
  const { encryptor, client } = await getSpaceEncryptor(spaceId, session, { owner: session.userId, members: [] });
  await updateObjectIndex(client, encryptor, objIndexPull(spaceId), objIndexPush(spaceId), mutator);
}
