/**
 * Resolve a room's SPACE name + ROOM name (+ kind) for a notification title. Used by the
 * Android headless push handler (`push/background-notify.native`), which has no provider
 * tree and so can't read the in-memory rooms-registry cache the web toast reads (the
 * web/desktop `notify` path resolves names from that cache via `nav.ensure`, not this
 * helper).
 *
 * The SPACE name is plaintext in the `_rooms` access record (read directly). The ROOM
 * name now lives in the ENCRYPTED object index, so the private path opens the space
 * keyring to decrypt it (PUBLIC spaces stay plaintext). The account cap reads `_rooms`
 * for joined spaces (membership-gated), and the member cap opens the keyring. Returns
 * null on total failure; a missing keyring (e.g. a space never opened on this device)
 * just yields a null roomName, and the caller falls back to the bare app-name title —
 * never blocking the message preview on name resolution.
 */
import type { Session } from '../starfish/identity';
import { readPrivateSpaceRooms } from '../starfish/object-index';
import { spaceIdFromRoomId } from '../starfish/paths';
import { isPublicSpaceId, publicSpaceAuth, publicSpaceClient, readPublicRoomsDoc } from '../starfish/pubspace';
import { readRooms } from '../starfish/registry';
import type { RoomKind } from '../domain/types';

export interface NotificationLabels {
  spaceName: string | null;
  roomName: string | null;
  roomKind: RoomKind | undefined;
}

export async function loadNotificationLabels(
  session: Session,
  roomId: string,
): Promise<NotificationLabels | null> {
  const spaceId = spaceIdFromRoomId(roomId);
  try {
    if (isPublicSpaceId(spaceId)) {
      const { ownerId } = publicSpaceAuth(session, spaceId);
      const { rooms, name } = await readPublicRoomsDoc(publicSpaceClient(session, spaceId), ownerId, spaceId);
      const room = rooms.find((r) => r.id === roomId);
      return { spaceName: name, roomName: room?.name ?? null, roomKind: room?.kind };
    }
    const { name } = await readRooms(session.accountClient, spaceId);
    const rooms = await readPrivateSpaceRooms(session, spaceId);
    const room = rooms.find((r) => r.id === roomId);
    return { spaceName: name, roomName: room?.name ?? null, roomKind: room?.kind };
  } catch {
    return null;
  }
}
