/**
 * Space + room registries (plaintext metadata docs). A user's spaces live at
 * `user/<userId>/_spaces`; each space's rooms at `spaces/<spaceId>/_rooms`.
 * A fresh identity starts with no spaces — the user creates or joins one.
 */
import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { CapMap, Room, Space } from '@/lib/types';

import {
  roomsRegistryPull,
  roomsRegistryPush,
  spacesPull,
  spacesPush,
} from './paths';

/** Owner-set, SHARED space identity, persisted in the `_rooms` registry doc
 *  (plaintext — NOT E2EE, the same as the name has always been). `image` is a
 *  data URI (see avatar-image). Both optional for back-compat with spaces whose
 *  registry predates this feature. */
export interface SpaceMeta {
  name?: string | null;
  image?: string | null;
}

/** A resolved name/image update fanned out so every mounted `useSpaces` adopts a
 *  freshly-reconciled value without waiting for its next navigation refresh
 *  (mirrors the name/avatar fan-out in use-profile.ts). */
export interface SpaceMetaUpdate {
  name: string;
  short: string;
  image?: string;
}
const spaceMetaListeners = new Set<(spaceId: string, meta: SpaceMetaUpdate) => void>();
/** Subscribe a live consumer (returns an unsubscribe). */
export function onSpaceMeta(fn: (spaceId: string, meta: SpaceMetaUpdate) => void): () => void {
  spaceMetaListeners.add(fn);
  return () => {
    spaceMetaListeners.delete(fn);
  };
}
export function broadcastSpaceMeta(spaceId: string, meta: SpaceMetaUpdate): void {
  for (const fn of spaceMetaListeners) fn(spaceId, meta);
}

/** The parsed `user/<userId>/_spaces` document: the joined-space list plus the
 *  durable member-cap map (see {@link CapMap}). */
interface SpacesDoc {
  spaces: Space[];
  caps: CapMap;
  hash: string | null;
}

/**
 * Pull the raw spaces doc, normalizing its two keys. A 404 (no doc yet) returns an
 * empty doc with `hash: null` so a first write can create it. Any OTHER error
 * propagates — callers doing read-modify-write must abort rather than clobber the
 * doc with empty content on a transient failure.
 */
async function pullSpacesDoc(client: StarfishClient, userId: string): Promise<SpacesDoc> {
  const res = await client.pull(spacesPull(userId)).catch((err: unknown) => {
    // No doc yet → an empty doc a first write can create. Other errors propagate.
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as { spaces?: Space[]; caps?: CapMap } | undefined;
  return {
    spaces: Array.isArray(data?.spaces) ? data!.spaces! : [],
    caps: data?.caps && typeof data.caps === 'object' ? data.caps : {},
    hash: res?.hash ?? null,
  };
}

export async function readSpaces(
  client: StarfishClient,
  userId: string,
): Promise<SpacesDoc> {
  try {
    return await pullSpacesDoc(client, userId);
  } catch (err) {
    // Don't collapse a reachability/auth failure into "no spaces" silently —
    // that reads as an empty account (e.g. a desktop build baked against an
    // unreachable server). Surface it; the caller still degrades to empty.
    console.error('[readSpaces] failed to pull spaces registry', err);
    return { spaces: [], caps: {}, hash: null };
  }
}

/**
 * Read-modify-write the whole `_spaces` doc through a single funnel. The mutator
 * runs on FRESH server state (re-read each attempt) and returns the next
 * `{ spaces, caps }`, so a caller can never accidentally drop the sibling key — it
 * must actively change it. Pushes are retried on {@link ConflictError} (a concurrent
 * writer — e.g. another device, or a cap-save racing a space-list edit) by re-reading
 * and re-applying. This is why caps and the space list can safely share one doc.
 */
export async function updateSpacesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: { spaces: Space[]; caps: CapMap }) => { spaces: Space[]; caps: CapMap },
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, hash } = await pullSpacesDoc(client, userId);
    const cur = { spaces, caps };
    const next = mutator(cur);
    if (next === cur) return; // no-op mutation (e.g. already joined) — skip the write
    try {
      await client.push(spacesPush(userId), { v: 1, spaces: next.spaces, caps: next.caps }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Replace the joined-space list, preserving the durable `caps` map. Implemented over
 * {@link updateSpacesDoc} so every existing caller is caps-safe with no call-site
 * change; the `caps` are read fresh on write. The prior `hash` is now vestigial (the
 * funnel re-reads) — last-writer-wins on the `spaces` array, which only races across
 * a user's own devices.
 */
export async function writeSpaces(
  client: StarfishClient,
  userId: string,
  spaces: Space[],
  _hash: string | null,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({ spaces, caps: cur.caps }));
}

/** Opaque, dedicated space id — independent of any userId. Ownership is recorded
 *  in the registry doc's `owner` field, not derivable from the id. */
function newSpaceId(): string {
  return `sp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function readRooms(
  client: StarfishClient,
  spaceId: string,
): Promise<{
  rooms: Room[];
  owner: string | null;
  members: string[];
  name: string | null;
  image: string | null;
  hash: string | null;
}> {
  const res = await client.pull(roomsRegistryPull(spaceId)).catch(() => null);
  const data = res?.data as
    | { rooms?: Room[]; owner?: string; members?: unknown[]; name?: string; image?: string }
    | undefined;
  return {
    rooms: Array.isArray(data?.rooms) ? data!.rooms! : [],
    owner: typeof data?.owner === 'string' ? data.owner : null,
    members: Array.isArray(data?.members)
      ? data!.members!.filter((m): m is string => typeof m === 'string')
      : [],
    name: typeof data?.name === 'string' ? data.name : null,
    image: typeof data?.image === 'string' ? data.image : null,
    hash: res?.hash ?? null,
  };
}

export async function writeRooms(
  client: StarfishClient,
  spaceId: string,
  rooms: Room[],
  owner: string,
  members: string[],
  hash: string | null,
  meta?: SpaceMeta,
): Promise<void> {
  // `owner` + `members` are the authoritative access record the server's
  // space:owner/space:member enricher reads to gate this registry and the space
  // keyring — stamp both on every write so neither is ever dropped. `name`/`image`
  // are the shared space identity; callers thread the values they read back through
  // so a registry write (e.g. adding a channel) never drops them. A falsy value is
  // omitted — that's how the owner clears the image.
  const name = meta?.name?.trim() || undefined;
  const image = meta?.image || undefined;
  await client.push(
    roomsRegistryPush(spaceId),
    { v: 1, owner, members, rooms, ...(name ? { name } : {}), ...(image ? { image } : {}) },
    hash,
  );
}

/** Owner-side: add an invitee's userId to the space roster → grants them
 *  `space:member` (read the registry + the space keyring). Idempotent. */
export async function addSpaceMember(
  client: StarfishClient,
  spaceId: string,
  ownerUserId: string,
  memberUserId: string,
): Promise<void> {
  const { rooms, owner, members, name, image, hash } = await readRooms(client, spaceId);
  if (memberUserId === (owner ?? ownerUserId) || members.includes(memberUserId)) return;
  await writeRooms(client, spaceId, rooms, owner ?? ownerUserId, [...members, memberUserId], hash, {
    name,
    image,
  });
}

/** Invitee-side: record a joined space in the identity's own space list. Caps are
 *  left untouched (used for public joins, which carry no member cap). Idempotent. */
export async function addJoinedSpace(client: StarfishClient, userId: string, space: Space): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) =>
    cur.spaces.some((s) => s.id === space.id) ? cur : { spaces: [...cur.spaces, space], caps: cur.caps },
  );
}

/**
 * Invitee-side: record a joined PRIVATE space AND persist its member cap in one
 * atomic doc write. Storing the cap in the user's own (seed-authenticated) `_spaces`
 * doc is what lets a fresh device re-hydrate it and self-heal — the cap is owner-
 * issued and not re-derivable, and it is not a secret (Starfish binds every request
 * to a fresh signature over `cap.sub`, so a stored cap is useless without the
 * member's private key). Idempotent on the space; the cap is always (re)written.
 */
export async function addJoinedSpaceWithCap(
  client: StarfishClient,
  userId: string,
  space: Space,
  capJson: string,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({
    spaces: cur.spaces.some((s) => s.id === space.id) ? cur.spaces : [...cur.spaces, space],
    caps: { ...cur.caps, [space.id]: capJson },
  }));
}

/** Create a new space (+ a seeded "general" channel) owned by the identity. */
export async function createSpace(client: StarfishClient, userId: string, name: string): Promise<Space> {
  const { spaces, hash } = await readSpaces(client, userId);
  const trimmed = name.trim() || 'New Space';
  const id = newSpaceId();
  const space: Space = { id, name: trimmed, short: trimmed.slice(0, 2).toUpperCase(), members: 1 };
  await writeSpaces(client, userId, [...spaces, space], hash);
  // Seed one channel + stamp ownership (TOFU: this first write claims the space)
  // and the shared name so invited members read it from the registry.
  const general: Room = { id: `${id}-general`, spaceId: id, category: 'CHANNELS', name: 'general', kind: 'channel' };
  await writeRooms(client, id, [general], userId, [], null, { name: trimmed });
  return space;
}

/** Append a new channel to a space's registry (owner-only write). */
export async function createRoom(
  client: StarfishClient,
  userId: string,
  spaceId: string,
  name: string,
  category = 'CHANNELS',
): Promise<Room> {
  const { rooms, owner, members, name: spaceName, image, hash } = await readRooms(client, spaceId);
  const room: Room = {
    id: `${spaceId}-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`,
    spaceId,
    category,
    name,
    kind: 'channel',
  };
  await writeRooms(client, spaceId, [...rooms, room], owner ?? userId, members, hash, {
    name: spaceName,
    image,
  });
  return room;
}

/**
 * Member/read side: fold the SHARED name/image (read from the space's `_rooms`
 * registry) into this identity's own `_spaces` cache so the rails + header reflect
 * an owner's edit. Shared values win when present; absent shared values keep the
 * local one (back-compat for pre-feature registries). A no-op when already in
 * sync, so it's cheap to call on every space open. Broadcasts so a live `useSpaces`
 * updates without waiting for its next navigation refresh.
 */
export async function reconcileSpaceMeta(
  client: StarfishClient,
  userId: string,
  spaceId: string,
  shared: SpaceMeta,
): Promise<void> {
  const sharedName = typeof shared.name === 'string' && shared.name.trim() ? shared.name : null;
  const sharedImage = typeof shared.image === 'string' && shared.image ? shared.image : null;
  if (sharedName === null && sharedImage === null) return; // nothing shared to apply
  const { spaces, hash } = await readSpaces(client, userId);
  const cur = spaces.find((s) => s.id === spaceId);
  if (!cur) return;
  const name = sharedName ?? cur.name;
  const image = sharedImage ?? cur.image;
  const short = name.slice(0, 2).toUpperCase();
  if (name === cur.name && short === cur.short && (image ?? null) === (cur.image ?? null)) return;
  const next = spaces.map((s) => (s.id === spaceId ? { ...s, name, short, image } : s));
  await writeSpaces(client, userId, next, hash);
  broadcastSpaceMeta(spaceId, { name, short, image });
}
