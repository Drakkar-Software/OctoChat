/**
 * Cross-room reads for search + threads: decrypt every room the identity has a
 * keyring for (i.e. rooms it has opened), and flatten their messages. Rooms
 * never opened have no keyring yet and are simply skipped.
 */
import type { Session } from './starfish/identity';
import { readIndexRooms } from './starfish/object-index';
import { objIndexPull, pubspaceRoomPull, roomPull } from './starfish/paths';
import { isPublicSpaceId, publicSpaceAuth, publicSpaceClient, readPublicRoomsDoc } from './starfish/pubspace';
import { readRooms } from './starfish/registry';
import { buildSpaceEncryptor } from './starfish/space-encryptor';
import type { StoredMsg } from './message-view';
import { buildThreadDigest, type ThreadSummary } from './threads';
import type { MessageEditEvent, PinEvent, Room } from './types';

export interface CrossRoomMessage {
  room: Room;
  msg: StoredMsg;
}

export interface CrossRoomThread {
  room: Room;
  thread: ThreadSummary;
}

export async function loadAllMessages(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const out: CrossRoomMessage[] = [];

  if (isPublicSpaceId(spaceId)) {
    // Public space: plaintext docs (no keyring/decrypt) read with the public client.
    const auth = publicSpaceAuth(session, spaceId);
    const client = publicSpaceClient(session, spaceId);
    const { rooms } = await readPublicRoomsDoc(client, auth.ownerId, spaceId);
    for (const room of rooms) {
      try {
        const res = await client.pull(pubspaceRoomPull(auth.ownerId, spaceId, room.id)).catch(() => null);
        const data = res?.data as { messages?: StoredMsg[] } | undefined;
        for (const m of data?.messages ?? []) out.push({ room, msg: m });
      } catch {
        /* skip rooms we can't read */
      }
    }
    return out;
  }

  // Private space: one encryptor for the space decrypts the index AND every channel's
  // per-room doc.
  const space = await buildSpaceEncryptor(session, spaceId);
  if (!space) return [];
  const { client, enc } = space;
  const rooms = (await readIndexRooms(client, enc, objIndexPull(spaceId), spaceId))?.rooms ?? [];

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

/**
 * Every thread (a parent message with ≥1 reply) across every decryptable room of
 * a space, flattened and sorted by most-recent activity. Mirrors
 * {@link loadAllMessages}' decrypt loop but folds each room's log into thread
 * summaries — with `edits`, so a thread's label reflects the parent's latest
 * edit/delete. `readBefore(roomId)` is the viewer's last-read mark for that room;
 * replies newer than it count toward the thread's unread badge.
 */
export async function loadAllThreads(
  session: Session,
  spaceId: string,
  readBefore: (roomId: string) => number,
): Promise<CrossRoomThread[]> {
  const space = await buildSpaceEncryptor(session, spaceId);
  if (!space) return [];
  const { client, enc } = space;
  const rooms = (await readIndexRooms(client, enc, objIndexPull(spaceId), spaceId))?.rooms ?? [];

  const out: CrossRoomThread[] = [];
  for (const room of rooms) {
    try {
      const res = await client.pull(roomPull(room.id)).catch(() => null);
      const data = res?.data as Record<string, unknown> | undefined;
      if (!data || !data._encrypted) continue;
      const plain = (await enc.decrypt(data)) as { messages?: StoredMsg[]; edits?: MessageEditEvent[] };
      // No per-room cap: the tab lists every thread, not the sidebar's top few.
      const digest = buildThreadDigest(plain.messages ?? [], plain.edits ?? [], readBefore(room.id), session.userId, Number.MAX_SAFE_INTEGER);
      for (const thread of digest) out.push({ room, thread });
    } catch {
      /* skip rooms we can't decrypt */
    }
  }
  return out.sort((a, b) => b.thread.lastActivityTs - a.thread.lastActivityTs);
}

/**
 * Every message the SPACE OWNER has pinned, across the merge-doc rooms of a space,
 * newest pin first. Folds the `pins` log per room: the latest event (by `ts`) authored
 * by the space `owner` wins (`pin` ⇒ included). Only the owner's events count — same
 * guard as `resolvePinned` — so a forged peer pin never surfaces. Handles both PRIVATE
 * (one space encryptor decrypts each room's doc) and PUBLIC (plaintext docs, public
 * client) spaces. Stream rooms are skipped like in {@link loadAllThreads}/{@link
 * loadAllMessages} (their log lives off the `roomPull` doc). Returns `[]` for a private
 * space with no resolvable owner/keyring.
 */
export async function loadAllPins(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const out: { room: Room; msg: StoredMsg; pinnedTs: number }[] = [];
  // Fold a room's pins → its pinned messages (latest owner event per id wins, `pin` ⇒
  // included). Shared by the private (decrypted) and public (plaintext) branches.
  const collect = (room: Room, owner: string, plain: { messages?: StoredMsg[]; pins?: PinEvent[] }) => {
    const latest = new Map<string, PinEvent>();
    for (const p of plain.pins ?? []) {
      if (p.userId !== owner) continue;
      const cur = latest.get(p.msgId);
      if (!cur || p.ts > cur.ts) latest.set(p.msgId, p);
    }
    const byId = new Map((plain.messages ?? []).map((m) => [m.id, m]));
    for (const [msgId, ev] of latest) {
      if (ev.kind !== 'pin') continue;
      const msg = byId.get(msgId);
      if (msg) out.push({ room, msg, pinnedTs: ev.ts });
    }
  };

  if (isPublicSpaceId(spaceId)) {
    // Public space: plaintext docs (no keyring/decrypt). Owner is the space owner id;
    // read the room list + each room's plaintext doc with the public client.
    const auth = publicSpaceAuth(session, spaceId);
    const client = publicSpaceClient(session, spaceId);
    const { rooms } = await readPublicRoomsDoc(client, auth.ownerId, spaceId);
    for (const room of rooms) {
      try {
        const res = await client.pull(pubspaceRoomPull(auth.ownerId, spaceId, room.id)).catch(() => null);
        const data = res?.data as { messages?: StoredMsg[]; pins?: PinEvent[] } | undefined;
        if (data) collect(room, auth.ownerId, data);
      } catch {
        /* skip rooms we can't read */
      }
    }
  } else {
    // Private space: one space encryptor decrypts the index AND every channel's doc.
    // `owner` (the only pin authority) stays in the `_rooms` access record.
    const { owner } = await readRooms(session.accountClient, spaceId);
    if (!owner) return [];
    const space = await buildSpaceEncryptor(session, spaceId);
    if (!space) return [];
    const { client, enc } = space;
    const rooms = (await readIndexRooms(client, enc, objIndexPull(spaceId), spaceId))?.rooms ?? [];
    for (const room of rooms) {
      try {
        const res = await client.pull(roomPull(room.id)).catch(() => null);
        const data = res?.data as Record<string, unknown> | undefined;
        if (!data || !data._encrypted) continue;
        const plain = (await enc.decrypt(data)) as { messages?: StoredMsg[]; pins?: PinEvent[] };
        collect(room, owner, plain);
      } catch {
        /* skip rooms we can't decrypt */
      }
    }
  }
  return out.sort((a, b) => b.pinnedTs - a.pinnedTs).map(({ room, msg }) => ({ room, msg }));
}
