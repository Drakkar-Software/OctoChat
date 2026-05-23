/**
 * Space + room registries (plaintext metadata docs). A user's spaces live at
 * `user/<userId>/_spaces`; each space's rooms at `spaces/<spaceId>/_rooms`.
 * A fresh identity starts with no spaces — the user creates or joins one.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { Room, Space } from '@/lib/types';

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

export async function readSpaces(
  client: StarfishClient,
  userId: string,
): Promise<{ spaces: Space[]; hash: string | null }> {
  const res = await client.pull(spacesPull(userId)).catch(() => null);
  const spaces = (res?.data as { spaces?: Space[] } | undefined)?.spaces;
  return { spaces: Array.isArray(spaces) ? spaces : [], hash: res?.hash ?? null };
}

export async function writeSpaces(
  client: StarfishClient,
  userId: string,
  spaces: Space[],
  hash: string | null,
): Promise<void> {
  await client.push(spacesPush(userId), { v: 1, spaces }, hash);
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

/** Invitee-side: record a joined space in the identity's own space list. */
export async function addJoinedSpace(client: StarfishClient, userId: string, space: Space): Promise<void> {
  const { spaces, hash } = await readSpaces(client, userId);
  if (spaces.some((s) => s.id === space.id)) return;
  await writeSpaces(client, userId, [...spaces, space], hash);
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
