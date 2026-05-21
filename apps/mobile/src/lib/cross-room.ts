/**
 * Cross-room reads for search + activity: decrypt every room the identity has a
 * keyring for (i.e. rooms it has opened), and flatten their messages. Rooms
 * never opened have no keyring yet and are simply skipped.
 */
import { buildEncryptor, makeClient } from './starfish/client';
import { getMemberCap } from './starfish/member-caps';
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
  // Keyring + access are space-wide, not per-room: a joined space uses its member
  // cap (keyed by spaceId) with the cap's issuer as the trusted keyring adder; an
  // owned space uses the account's chat client and our own key. Resolve one
  // encryptor for the space and decrypt every channel's per-room doc with it.
  const memberCap = getMemberCap(spaceId);
  let client = session.chatClient;
  let trustedAdders = [session.keys.edPub];
  if (memberCap) {
    const cap = JSON.parse(memberCap) as { iss?: string };
    client = makeClient(cap, session.keys.edPriv);
    if (cap.iss) trustedAdders = [cap.iss];
  }
  const enc = await buildEncryptor(client, session.keys, spaceId, trustedAdders);
  if (!enc) return [];

  const out: CrossRoomMessage[] = [];
  for (const room of rooms) {
    try {
      const res = await client.pull(roomPull(room.id)).catch(() => null);
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
