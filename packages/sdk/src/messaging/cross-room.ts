/**
 * Cross-room reads for search + threads: decrypt every room the identity has a
 * keyring for (i.e. rooms it has opened), and flatten their messages. Rooms
 * never opened have no keyring yet and are simply skipped.
 *
 * Every room is an APPEND-ONLY log now (the merge-doc `chat`/`pubspace` message path
 * was retired when `stream` and `channel` merged), so each reader pulls a room's whole
 * log and folds it via {@link fanOut} — exactly like `useRoom` / `notification-preview`.
 */
import type { AppendElement, Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull, pubstreamRoomPull, streamRoomPull } from '../starfish/paths';
import { isPublicSpaceId, publicSpaceAuth, publicSpaceClient, readPublicRoomsDoc } from '../starfish/pubspace';
import { readRooms } from '../starfish/registry';
import { buildSpaceEncryptor } from '../starfish/space-encryptor';
import type { StoredMsg } from '../format/message-view';
import { fanOut, type StreamData } from './stream-log';
import { buildThreadDigest, type ThreadSummary } from './threads';
import type { Room } from '../domain/types';

export interface CrossRoomMessage {
  room: Room;
  msg: StoredMsg;
}

export interface CrossRoomThread {
  room: Room;
  thread: ThreadSummary;
}

/** Pull a room's WHOLE append-only log and fold it into the typed `{messages, edits,
 *  pins, …}` arrays. Private rooms decrypt each element with the space encryptor; a
 *  public room reads the plaintext envelope directly (`enc: null`). A single
 *  undecryptable element is skipped, never blanking the room; a pull failure yields an
 *  empty fold. The `full` flag bounds the append-only pull (a19) to the whole log. */
async function foldRoomLog(client: StarfishClient, enc: Encryptor | null, pullPath: string): Promise<StreamData> {
  const items = (await client
    .pull<{ ts: number; data: Record<string, unknown> }>(pullPath, { appendField: 'items', full: true })
    .catch(() => [])) as { ts: number; data: Record<string, unknown> }[];
  if (!enc) return fanOut((items ?? []) as unknown as AppendElement[]);
  const decrypted: { ts: number; data: unknown }[] = [];
  for (const item of items ?? []) {
    try {
      decrypted.push({ ts: item.ts, data: await enc.decrypt(item.data) });
    } catch {
      /* a single undecryptable element must not blank the whole room */
    }
  }
  return fanOut(decrypted as AppendElement[]);
}

export async function loadAllMessages(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const out: CrossRoomMessage[] = [];

  if (isPublicSpaceId(spaceId)) {
    // Public space: plaintext append logs (no keyring/decrypt) read with the public client.
    const auth = publicSpaceAuth(session, spaceId);
    const client = publicSpaceClient(session, spaceId);
    const { rooms } = await readPublicRoomsDoc(client, auth.ownerId, spaceId);
    for (const room of rooms) {
      const { messages } = await foldRoomLog(client, null, pubstreamRoomPull(auth.ownerId, spaceId, room.id));
      for (const m of messages) out.push({ room, msg: m });
    }
    return out;
  }

  // Private space: one encryptor for the space decrypts the index AND every room's log.
  const space = await buildSpaceEncryptor(session, spaceId);
  if (!space) return [];
  const { client, enc } = space;
  const rooms = (await readIndexRooms(client, enc, objIndexPull(spaceId), spaceId))?.rooms ?? [];

  for (const room of rooms) {
    const { messages } = await foldRoomLog(client, enc, streamRoomPull(room.id));
    for (const m of messages) out.push({ room, msg: m });
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
    const { messages, edits } = await foldRoomLog(client, enc, streamRoomPull(room.id));
    // No per-room cap: the tab lists every thread, not the sidebar's top few.
    const digest = buildThreadDigest(messages, edits, readBefore(room.id), session.userId, Number.MAX_SAFE_INTEGER);
    for (const thread of digest) out.push({ room, thread });
  }
  return out.sort((a, b) => b.thread.lastActivityTs - a.thread.lastActivityTs);
}

/**
 * Every message the SPACE OWNER has pinned, across every room of a space, newest pin
 * first. Folds each room's append log: the latest pin event (by `ts`) authored by the
 * space `owner` wins (`pin` ⇒ included). Only the owner's events count — same guard as
 * `resolvePinned` — so a forged peer pin never surfaces. Handles both PRIVATE (one space
 * encryptor decrypts each room's log) and PUBLIC (plaintext logs, public client) spaces.
 * Returns `[]` for a private space with no resolvable owner/keyring.
 */
export async function loadAllPins(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const out: { room: Room; msg: StoredMsg; pinnedTs: number }[] = [];
  // Fold a room's folded log → its pinned messages (latest owner event per id wins,
  // `pin` ⇒ included). Shared by the private (decrypted) and public (plaintext) branches.
  const collect = (room: Room, owner: string, log: StreamData) => {
    const latest = new Map<string, (typeof log.pins)[number]>();
    for (const p of log.pins) {
      if (p.userId !== owner) continue;
      const cur = latest.get(p.msgId);
      if (!cur || p.ts > cur.ts) latest.set(p.msgId, p);
    }
    const byId = new Map(log.messages.map((m) => [m.id, m]));
    for (const [msgId, ev] of latest) {
      if (ev.kind !== 'pin') continue;
      const msg = byId.get(msgId);
      if (msg) out.push({ room, msg, pinnedTs: ev.ts });
    }
  };

  if (isPublicSpaceId(spaceId)) {
    // Public space: plaintext append logs (no keyring/decrypt). Owner is the space owner
    // id; read the room list + fold each room's log with the public client.
    const auth = publicSpaceAuth(session, spaceId);
    const client = publicSpaceClient(session, spaceId);
    const { rooms } = await readPublicRoomsDoc(client, auth.ownerId, spaceId);
    for (const room of rooms) {
      collect(room, auth.ownerId, await foldRoomLog(client, null, pubstreamRoomPull(auth.ownerId, spaceId, room.id)));
    }
  } else {
    // Private space: one space encryptor decrypts the index AND every room's log.
    // `owner` (the only pin authority) stays in the `_rooms` access record.
    const { owner } = await readRooms(session.accountClient, spaceId);
    if (!owner) return [];
    const space = await buildSpaceEncryptor(session, spaceId);
    if (!space) return [];
    const { client, enc } = space;
    const rooms = (await readIndexRooms(client, enc, objIndexPull(spaceId), spaceId))?.rooms ?? [];
    for (const room of rooms) {
      collect(room, owner, await foldRoomLog(client, enc, streamRoomPull(room.id)));
    }
  }
  return out.sort((a, b) => b.pinnedTs - a.pinnedTs).map(({ room, msg }) => ({ room, msg }));
}
