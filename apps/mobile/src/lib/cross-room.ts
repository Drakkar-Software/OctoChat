/**
 * Cross-room reads for search + activity: decrypt every room the identity has a
 * keyring for (i.e. rooms it has opened), and flatten their messages. Rooms
 * never opened have no keyring yet and are simply skipped.
 */
import { buildEncryptor } from './starfish/client';
import type { Session } from './starfish/identity';
import { roomPull } from './starfish/paths';
import { readRooms } from './starfish/registry';
import type { StoredMsg } from './message-view';
import type { Room } from './types';

export interface CrossRoomMessage {
  room: Room;
  msg: StoredMsg;
}

export async function loadAllMessages(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const { rooms } = await readRooms(session.accountClient, spaceId);
  const out: CrossRoomMessage[] = [];
  for (const room of rooms) {
    try {
      const enc = await buildEncryptor(session.chatClient, session.keys, room.id);
      if (!enc) continue;
      const res = await session.chatClient.pull(roomPull(room.id)).catch(() => null);
      const data = res?.data as Record<string, unknown> | undefined;
      if (!data || !data._encrypted) continue;
      const plain = (await enc.decrypt(data)) as { messages?: StoredMsg[] };
      for (const m of plain.messages ?? []) out.push({ room, msg: m });
    } catch {
      /* skip rooms we can't decrypt */
    }
  }
  return out;
}
