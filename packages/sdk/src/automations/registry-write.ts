/**
 * Per-room `automation` field mutators that go through the existing registry
 * funnels. Because `automation?` lives on the per-Room entry and every existing
 * writer rewrites the whole `rooms[]` array, threading is automatic — these
 * helpers only need to find the room and patch its automation, then re-submit
 * via the conflict-retrying funnel. v1 only public spaces — the create UI
 * blocks private; this guard is here so a stray call doesn't silently no-op.
 */
import { isPublicSpaceId, updatePublicRoomsRegistry } from '../starfish/pubspace';
import type { Session } from '../starfish/identity';
import type { AutomationMeta, Room } from '../domain/types';

export class AutomationsNotSupportedHere extends Error {
  constructor() {
    super('Automated rooms are available only in public spaces in this version.');
  }
}

export async function setRoomAutomation(
  session: Session,
  spaceId: string,
  roomId: string,
  next: AutomationMeta,
): Promise<void> {
  if (!isPublicSpaceId(spaceId)) throw new AutomationsNotSupportedHere();
  await updatePublicRoomsRegistry(session, spaceId, (cur) => {
    const idx = cur.rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return null;
    const rooms = [...cur.rooms];
    rooms[idx] = { ...rooms[idx]!, automation: next };
    return { rooms, categories: cur.categories };
  });
}

export async function patchRoomAutomation(
  session: Session,
  spaceId: string,
  roomId: string,
  patch: Partial<AutomationMeta>,
): Promise<void> {
  if (!isPublicSpaceId(spaceId)) throw new AutomationsNotSupportedHere();
  await updatePublicRoomsRegistry(session, spaceId, (cur) => {
    const idx = cur.rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return null;
    const room: Room = cur.rooms[idx]!;
    if (!room.automation) return null;
    const rooms = [...cur.rooms];
    rooms[idx] = { ...room, automation: { ...room.automation, ...patch } };
    return { rooms, categories: cur.categories };
  });
}

/** Rename a room (its display name in the channel list / chat header). Public-space
 *  only — automations don't exist elsewhere. No-op when the room is gone, the name is
 *  blank, or it's unchanged. Like the other writers here it rewrites the whole
 *  `rooms[]` array through the conflict-retrying funnel. */
export async function renameRoomInRegistry(
  session: Session,
  spaceId: string,
  roomId: string,
  name: string,
): Promise<void> {
  if (!isPublicSpaceId(spaceId)) throw new AutomationsNotSupportedHere();
  const trimmed = name.trim();
  if (!trimmed) return;
  await updatePublicRoomsRegistry(session, spaceId, (cur) => {
    const idx = cur.rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return null;
    const room: Room = cur.rooms[idx]!;
    if (room.name === trimmed) return null;
    const rooms = [...cur.rooms];
    rooms[idx] = { ...room, name: trimmed };
    return { rooms, categories: cur.categories };
  });
}

export async function deleteRoomFromRegistry(
  session: Session,
  spaceId: string,
  roomId: string,
): Promise<void> {
  if (!isPublicSpaceId(spaceId)) throw new AutomationsNotSupportedHere();
  await updatePublicRoomsRegistry(session, spaceId, (cur) => {
    const next = cur.rooms.filter((r) => r.id !== roomId);
    if (next.length === cur.rooms.length) return null;
    return { rooms: next, categories: cur.categories };
  });
}
