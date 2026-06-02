/**
 * Space-size & content stats for the space-details screen — a CLIENT-SIDE
 * computed snapshot, since Starfish exposes no metadata/size endpoint (pull only
 * returns `{ data, hash, ts }`, and a private space is ciphertext to the server).
 *
 * Room count is free (the registry). Everything else is a fan-out: pull + decrypt
 * every room of the space and fold its log. The decrypt branching mirrors
 * `notification-preview.ts` (private/public × merge-doc/stream) — NOT
 * `cross-room.ts:loadAllMessages`, which skips stream + public rooms and would
 * silently undercount.
 *
 * Semantics worth knowing (they differ on purpose):
 *  - `messages` is NET OF DELETES (a tombstoned message is folded out, matching what
 *    the user sees in-room).
 *  - `attachments` counts attachments on ALL messages incl. deleted — the sealed blob
 *    stays in storage after a delete tombstone, so it still occupies space.
 *  - `bytes` is APPROXIMATE: the JSON byte length of each room's stored doc (the
 *    encrypted envelope for private; plaintext for public) plus the plaintext size of
 *    each attachment. Char-length == byte-length for the base64 ciphertext envelopes;
 *    public plaintext with multibyte chars slightly undercounts. It is NOT the server's
 *    on-disk ciphertext figure (no endpoint reports that).
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { buildSpaceEncryptor } from './cross-room';
import { resolveEdit, type StoredMsg } from './message-view';
import { makeClient } from './starfish/client';
import type { Session } from './starfish/identity';
import { pubspaceRoomPull, pubstreamRoomPull, roomPull, streamRoomPull } from './starfish/paths';
import { isPublicSpaceId, publicSpaceAuth, readPublicRoomsDoc } from './starfish/pubspace';
import { readRooms } from './starfish/registry';
import { buildThreadDigest } from './threads';
import type { MessageEditEvent, Room } from './types';

export interface SpaceStats {
  /** Rooms/channels in the space (from the registry). */
  rooms: number;
  /** Total messages across all rooms, net of deletes. */
  messages: number;
  /** Threads — parent messages with ≥1 reply, across all rooms. */
  threads: number;
  /** Messages carrying an attachment (incl. on deleted messages). */
  attachments: number;
  /** Approximate total stored size in bytes (see file header). */
  bytes: number;
  /** True if any room failed to pull/decrypt — the totals are an undercount. */
  partial: boolean;
}

/** A stream room's append-log element, as decrypted — same typed envelope
 *  `use-stream-room` / `notification-preview` read. */
type StreamEnvelope =
  | { t: 'msg'; e: StoredMsg }
  | { t: 'edit'; e: MessageEditEvent }
  | { t: 'reaction'; e: unknown };

interface RoomLog {
  messages: StoredMsg[];
  edits: MessageEditEvent[];
  /** Byte size of the room's stored document(s); excludes attachment blobs. */
  docBytes: number;
}

const EMPTY_LOG: RoomLog = { messages: [], edits: [], docBytes: 0 };

/** JSON byte length (char-length is exact for base64 ciphertext envelopes). */
const byteLen = (doc: unknown): number => JSON.stringify(doc ?? null).length;

// ── per-room folders, one per (private|public) × (merge|stream) path ──────────

async function privateMergeLog(client: StarfishClient, enc: Encryptor, roomId: string): Promise<RoomLog> {
  const res = await client.pull(roomPull(roomId)).catch(() => null);
  const data = res?.data as Record<string, unknown> | undefined;
  if (!data) return EMPTY_LOG; // no doc yet — an empty room, not an error
  if (!data._encrypted) return { messages: [], edits: [], docBytes: byteLen(data) };
  const plain = (await enc.decrypt(data)) as { messages?: StoredMsg[]; edits?: MessageEditEvent[] };
  return { messages: plain.messages ?? [], edits: plain.edits ?? [], docBytes: byteLen(data) };
}

async function privateStreamLog(client: StarfishClient, enc: Encryptor, roomId: string): Promise<RoomLog> {
  const items = (await client.pull<{ ts: number; data: Record<string, unknown> }>(streamRoomPull(roomId), {
    appendField: 'items',
    full: true, // a19: append-only pulls must be bounded; stats fold the whole log
  })) as { ts: number; data: Record<string, unknown> }[];
  const messages: StoredMsg[] = [];
  const edits: MessageEditEvent[] = [];
  for (const item of items ?? []) {
    try {
      const env = (await enc.decrypt(item.data)) as StreamEnvelope;
      if (env?.t === 'msg') messages.push({ ...env.e, ts: env.e.ts || item.ts });
      else if (env?.t === 'edit') edits.push({ ...env.e, ts: env.e.ts || item.ts });
    } catch {
      /* a single undecryptable element must not blank the whole room */
    }
  }
  return { messages, edits, docBytes: byteLen(items) };
}

async function publicMergeLog(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
  roomId: string,
): Promise<RoomLog> {
  const res = await client.pull(pubspaceRoomPull(ownerId, spaceId, roomId)).catch(() => null);
  const data = res?.data as { messages?: StoredMsg[]; edits?: MessageEditEvent[] } | undefined;
  if (!data) return EMPTY_LOG;
  return { messages: data.messages ?? [], edits: data.edits ?? [], docBytes: byteLen(data) };
}

async function publicStreamLog(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
  roomId: string,
): Promise<RoomLog> {
  const items = (await client.pull<{ ts: number; data: Record<string, unknown> }>(
    pubstreamRoomPull(ownerId, spaceId, roomId),
    { appendField: 'items', full: true }, // a19: bound the append-only pull (whole log)
  )) as { ts: number; data: Record<string, unknown> }[];
  const messages: StoredMsg[] = [];
  const edits: MessageEditEvent[] = [];
  for (const item of items ?? []) {
    const env = item.data as unknown as StreamEnvelope; // plaintext: the envelope IS item.data
    if (env?.t === 'msg') messages.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env?.t === 'edit') edits.push({ ...env.e, ts: env.e.ts || item.ts });
  }
  return { messages, edits, docBytes: byteLen(items) };
}

/** Fold one room's log into the running totals. */
function accumulate(stats: SpaceStats, log: RoomLog, selfId: string): void {
  stats.bytes += log.docBytes;
  for (const m of log.messages) {
    const edit = resolveEdit(log.edits, m.id, m.authorId);
    if (edit?.kind !== 'delete') stats.messages += 1; // net of deletes
    if (m.attachment) {
      stats.attachments += 1;
      stats.bytes += m.attachment.size;
    }
  }
  // limit = MAX so EVERY thread counts (not the sidebar's top few).
  stats.threads += buildThreadDigest(log.messages, log.edits, 0, selfId, Number.MAX_SAFE_INTEGER).length;
}

/**
 * Compute the size + content stats for a space. A snapshot: one pull + decrypt per
 * room, so cost scales with the space. Failures per room set `partial` and are
 * skipped rather than blanking the whole result.
 */
export async function loadSpaceStats(session: Session, spaceId: string): Promise<SpaceStats> {
  const stats: SpaceStats = { rooms: 0, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: false };

  let rooms: Room[] = [];
  let foldRoom: (room: Room) => Promise<RoomLog>;

  if (isPublicSpaceId(spaceId)) {
    const auth = publicSpaceAuth(session, spaceId);
    const client = makeClient(auth.cap, auth.signingKey);
    rooms = (await readPublicRoomsDoc(client, auth.ownerId, spaceId).catch(() => null))?.rooms ?? [];
    foldRoom = (room) =>
      room.kind === 'stream'
        ? publicStreamLog(client, auth.ownerId, spaceId, room.id)
        : publicMergeLog(client, auth.ownerId, spaceId, room.id);
  } else {
    rooms = (await readRooms(session.accountClient, spaceId).catch(() => null))?.rooms ?? [];
    const space = await buildSpaceEncryptor(session, spaceId);
    if (!space) {
      // No keyring for this space yet — we can report the room count but nothing else.
      stats.rooms = rooms.length;
      stats.partial = rooms.length > 0;
      return stats;
    }
    const { client, enc } = space;
    foldRoom = (room) =>
      room.kind === 'stream' ? privateStreamLog(client, enc, room.id) : privateMergeLog(client, enc, room.id);
  }

  stats.rooms = rooms.length;
  for (const room of rooms) {
    try {
      accumulate(stats, await foldRoom(room), session.userId);
    } catch {
      stats.partial = true; // room unreadable — totals undercount
    }
  }
  return stats;
}
