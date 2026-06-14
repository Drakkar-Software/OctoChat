/**
 * Cross-room reads for search + threads: open the right client + encryptor per room
 * and flatten their messages. Rooms never accessed have no keyring cached and are simply
 * skipped (buildNodeAccess returns null).
 *
 * Every room is an APPEND-ONLY log now, so each reader pulls a room's whole
 * log and folds it via {@link fanOut} — exactly like `useRoom` / `notification-preview`.
 *
 * Stream path routing by `room.access`/`room.enc` (projected from the index):
 *   public  → `streamPubRoomPull` (plaintext, no encryptor)
 *   space/invite + enc:true  → `streamRoomPull` (E2EE, space keyring)
 *   space/invite + enc:false → `streamRoomPull` (member-gated plaintext)
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { buildNodeAccess, getSpaceClient } from '@drakkar.software/octospaces-sdk';

import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull, streamInvRoomPull, streamPubRoomPull, streamRoomPull } from '../starfish/paths';
import { readSpaceAccess } from '../starfish/registry';
import type { StoredMsg } from '../format/message-view';
import { fanOut, pullAndFold, type StreamData } from './stream-log';
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

/** Fold a room's whole append-only log via the shared {@link pullAndFold}, swallowing a
 *  pull failure to an empty fold — a single unreachable/never-opened room must not abort
 *  a space-wide search/threads/pins sweep (skip it, keep the rest). */
const foldRoomLog = (client: StarfishClient, enc: Encryptor | null, pullPath: string): Promise<StreamData> =>
  pullAndFold(client, enc, pullPath).then((r) => r.data).catch(() => fanOut([]));

/** Resolve the stream pull path for a room based on its access tier.
 *  public → streampub; invite+enc:false → streaminv; else → streamchat. */
function roomPullPath(room: Room): string {
  if (room.access === 'public') return streamPubRoomPull(room.id);
  if (room.access === 'invite' && !room.enc) return streamInvRoomPull(room.id);
  return streamRoomPull(room.id);
}

export async function loadAllMessages(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const out: CrossRoomMessage[] = [];
  const client = getSpaceClient(spaceId, session);
  // Object index is always plaintext (enc: none) — no encryptor needed.
  const rooms = (await readIndexRooms(client, null, objIndexPull(spaceId), spaceId))?.rooms ?? [];

  for (const room of rooms) {
    // Soft-open per-room access: enc rooms get a decryptor; plaintext rooms get null.
    const access = await buildNodeAccess(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
    const { messages } = await foldRoomLog(
      access?.client ?? client,
      access?.encryptor ?? null,
      roomPullPath(room),
    );
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
  const client = getSpaceClient(spaceId, session);
  const rooms = (await readIndexRooms(client, null, objIndexPull(spaceId), spaceId))?.rooms ?? [];

  const out: CrossRoomThread[] = [];
  for (const room of rooms) {
    const access = await buildNodeAccess(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
    const { messages, edits } = await foldRoomLog(
      access?.client ?? client,
      access?.encryptor ?? null,
      roomPullPath(room),
    );
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
 * `resolvePinned` — so a forged peer pin never surfaces.
 * Returns `[]` for a space with no resolvable owner/keyring.
 */
export async function loadAllPins(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  const out: { room: Room; msg: StoredMsg; pinnedTs: number }[] = [];
  const client = getSpaceClient(spaceId, session);

  // `owner` (the only pin authority) lives in the `_access` registry.
  const { owner } = await readSpaceAccess(client, spaceId);
  if (!owner) return [];

  // Fold a room's folded log → its pinned messages (latest owner event per id wins, `pin` ⇒ included).
  const collect = (room: Room, log: StreamData) => {
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

  const rooms = (await readIndexRooms(client, null, objIndexPull(spaceId), spaceId))?.rooms ?? [];
  for (const room of rooms) {
    const access = await buildNodeAccess(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
    collect(room, await foldRoomLog(access?.client ?? client, access?.encryptor ?? null, roomPullPath(room)));
  }
  return out.sort((a, b) => b.pinnedTs - a.pinnedTs).map(({ room, msg }) => ({ room, msg }));
}
