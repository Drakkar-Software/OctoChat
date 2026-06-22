/**
 * Resolve a room's SPACE name + ROOM name (+ kind) for a notification title. Used by the
 * Android headless push handler (`push/background-notify.native`), which has no provider
 * tree and so can't read the in-memory rooms-registry cache the web toast reads.
 *
 * The SPACE name is plaintext in the `_access` record. The ROOM name lives in the object
 * index (always plaintext since `objindex` moved to `enc: none`), so both reads go through
 * the member-gated space client — no encryptor needed for either. Returns null on total
 * failure; a missing room in the index yields a null roomName and the caller falls back to
 * the bare app-name title.
 */
import { getSpaceClient } from '@drakkar.software/starfish-spaces';
import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull, spaceIdFromRoomId } from '../starfish/paths';
import { readSpaceAccess } from '../starfish/registry';
import type { RoomKind } from '../domain/types';

export interface NotificationLabels {
  spaceName: string | null;
  roomName: string | null;
  roomKind: RoomKind | undefined;
}

export async function loadNotificationLabels(
  session: Session,
  roomId: string,
  spaceId?: string,
): Promise<NotificationLabels | null> {
  // Prefer the caller-supplied space id (the SSE event / FCM payload carries it). Deriving
  // the space from the room id is LOSSY: it only round-trips for `sp-`/`dm-` rooms and
  // returns a bogus space for `ticket-<hex>` ids (no embedded space) — which would make
  // every read below fail and the notification silently degrade. See spaceIdFromRoomId.
  const sid = spaceId ?? spaceIdFromRoomId(roomId);
  try {
    const client = getSpaceClient(sid, session);
    const [{ name: spaceName }, indexResult] = await Promise.all([
      readSpaceAccess(client, sid, session),
      readIndexRooms(client, null, objIndexPull(sid), sid),
    ]);
    const room = indexResult?.rooms.find((r) => r.id === roomId);
    return { spaceName: spaceName ?? null, roomName: room?.name ?? null, roomKind: room?.kind };
  } catch {
    return null;
  }
}
