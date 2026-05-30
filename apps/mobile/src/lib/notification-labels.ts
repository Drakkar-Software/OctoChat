/**
 * Resolve a room's SPACE name + ROOM name (+ kind) for a notification title by
 * reading the plaintext `_rooms` registry on demand. Used by the Android headless
 * push handler (`push/background-notify.native`), which has no provider tree and so
 * can't read the in-memory rooms-registry cache the web toast reads (the web/desktop
 * `notify` path resolves names from that cache via `nav.ensure`, not this helper).
 *
 * Names are plaintext metadata (NOT E2EE — the same registry the foreground app
 * reads), so both the private and public paths read them directly, no decryption.
 * The account cap reads the `_rooms` doc for joined spaces too (membership-gated in
 * the doc), so this needs no cap beyond what the handler already hydrates. Returns
 * null on any failure — the caller then falls back to the bare app-name title,
 * never blocking the message preview on name resolution.
 */
import type { Session } from './starfish/identity';
import { spaceIdFromRoomId } from './starfish/paths';
import {
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  readPublicRoomsDoc,
} from './starfish/pubspace';
import { readRooms } from './starfish/registry';
import type { RoomKind } from './types';

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
    const { rooms, name } = await readRooms(session.accountClient, spaceId);
    const room = rooms.find((r) => r.id === roomId);
    return { spaceName: name, roomName: room?.name ?? null, roomKind: room?.kind };
  } catch {
    return null;
  }
}
