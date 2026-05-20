/**
 * Space + room registries (plaintext metadata docs). A user's spaces live at
 * `user/<userId>/_spaces`; each space's rooms at `spaces/<spaceId>/_rooms`.
 * A fresh identity is seeded with one space and a few channels so the app is
 * never empty.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { Room, Space } from '@/lib/types';

import {
  roomsRegistryPull,
  roomsRegistryPush,
  spacesPull,
  spacesPush,
} from './paths';

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

export async function readRooms(
  client: StarfishClient,
  spaceId: string,
): Promise<{ rooms: Room[]; hash: string | null }> {
  const res = await client.pull(roomsRegistryPull(spaceId)).catch(() => null);
  const rooms = (res?.data as { rooms?: Room[] } | undefined)?.rooms;
  return { rooms: Array.isArray(rooms) ? rooms : [], hash: res?.hash ?? null };
}

export async function writeRooms(
  client: StarfishClient,
  spaceId: string,
  rooms: Room[],
  hash: string | null,
): Promise<void> {
  await client.push(roomsRegistryPush(spaceId), { v: 1, rooms }, hash);
}

/** Seed a default space + channels for a brand-new identity. Idempotent. */
export async function ensureDefaults(client: StarfishClient, userId: string): Promise<Space> {
  const existing = await readSpaces(client, userId);
  let spaces = existing.spaces;
  if (spaces.length === 0) {
    const space: Space = { id: `sp-${userId.slice(0, 8)}`, name: 'My Space', short: 'MY', members: 1 };
    spaces = [space];
    await writeSpaces(client, userId, spaces, existing.hash);
  }
  const space = spaces[0]!;

  const rooms = await readRooms(client, space.id);
  if (rooms.rooms.length === 0) {
    const seeded: Room[] = ['general', 'random', 'design'].map((name) => ({
      id: `${space.id}-${name}`,
      spaceId: space.id,
      category: 'CHANNELS',
      name,
      kind: 'channel' as const,
    }));
    await writeRooms(client, space.id, seeded, rooms.hash);
  }
  return space;
}

/** Add a room joined via invite into the identity's default space, under "JOINED". */
export async function addJoinedRoom(client: StarfishClient, userId: string, roomId: string): Promise<void> {
  const space = await ensureDefaults(client, userId);
  const { rooms, hash } = await readRooms(client, space.id);
  if (rooms.some((r) => r.id === roomId)) return;
  const room: Room = {
    id: roomId,
    spaceId: space.id,
    category: 'JOINED',
    name: `room-${roomId.slice(-6)}`,
    kind: 'channel',
  };
  await writeRooms(client, space.id, [...rooms, room], hash);
}

/** Append a new channel to a space's registry. */
export async function createRoom(
  client: StarfishClient,
  spaceId: string,
  name: string,
  category = 'CHANNELS',
): Promise<Room> {
  const { rooms, hash } = await readRooms(client, spaceId);
  const room: Room = {
    id: `${spaceId}-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`,
    spaceId,
    category,
    name,
    kind: 'channel',
  };
  await writeRooms(client, spaceId, [...rooms, room], hash);
  return room;
}
