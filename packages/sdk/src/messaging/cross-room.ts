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
import { getSpaceClient } from '@drakkar.software/octospaces-sdk';
import { buildNodeAccessShared } from '../starfish/node-access-cache';

import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull } from '../starfish/paths';
import { roomStreamPull } from './room-paths';
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

/** Soft-open a room's per-node access (enc rooms get a decryptor; plaintext → null;
 *  a never-opened room → fall back to the space client) and fold its whole log. */
function foldRoom(
  session: Session,
  spaceId: string,
  fallbackClient: StarfishClient,
  room: Room,
): Promise<StreamData> {
  return buildNodeAccessShared(session, spaceId, room.id, { enc: room.enc })
    .catch(() => null)
    .then((access) => foldRoomLog(access?.client ?? fallbackClient, access?.encryptor ?? null, roomStreamPull(room, room.id)));
}

/** Open the space client, list its rooms (index is always plaintext — no encryptor),
 *  fold each room's log, and flat-map `collect` across them. The shared scaffold behind
 *  the cross-room sweeps; only the per-room projection differs. */
async function forEachSpaceRoom<T>(
  session: Session,
  spaceId: string,
  collect: (room: Room, log: StreamData) => T[],
): Promise<T[]> {
  const client = getSpaceClient(spaceId, session);
  const rooms = (await readIndexRooms(client, null, objIndexPull(spaceId), spaceId))?.rooms ?? [];
  const out: T[] = [];
  for (const room of rooms) out.push(...collect(room, await foldRoom(session, spaceId, client, room)));
  return out;
}

export async function loadAllMessages(session: Session, spaceId: string): Promise<CrossRoomMessage[]> {
  return forEachSpaceRoom(session, spaceId, (room, { messages }) => messages.map((msg) => ({ room, msg })));
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
  const out = await forEachSpaceRoom(session, spaceId, (room, { messages, edits }) =>
    // No per-room cap: the tab lists every thread, not the sidebar's top few.
    buildThreadDigest(messages, edits, readBefore(room.id), session.userId, Number.MAX_SAFE_INTEGER).map(
      (thread) => ({ room, thread }),
    ),
  );
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
  for (const room of rooms) collect(room, await foldRoom(session, spaceId, client, room));
  return out.sort((a, b) => b.pinnedTs - a.pinnedTs).map(({ room, msg }) => ({ room, msg }));
}
