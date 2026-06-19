/**
 * Internal stream-path routing shared by the read sweeps (cross-room search/threads/pins,
 * space-stats, notification-preview). NOT part of the package's public surface — nothing
 * here is re-exported from `index.ts`.
 *
 * NOTE: only the PULL tier is shared. The push mapping is asymmetric (an invite+enc room
 * pushes to `streamInvRoomPush` but pulls from `streamRoomPull`) and is entangled with
 * per-room client/encryptor selection, so push paths stay inline at their call sites.
 */
import type { Room } from '../domain/types';
import { streamInvRoomPull, streamPubRoomPull, streamRoomPull } from '../starfish/paths';

/**
 * The stream PULL path for a room by access tier:
 *   public → streampub; invite + enc:false → streaminv; else → streamchat.
 *
 * `room` may be `undefined` (an index miss / cold start), in which case it falls through
 * to `streamRoomPull` — matching notification-preview's first-notification behaviour.
 */
export function roomStreamPull(room: Pick<Room, 'access' | 'enc'> | undefined, roomId: string): string {
  if (room?.access === 'public') return streamPubRoomPull(roomId);
  if (room?.access === 'invite' && !room.enc) return streamInvRoomPull(roomId);
  return streamRoomPull(roomId);
}
