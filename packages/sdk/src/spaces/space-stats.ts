/**
 * Space-size & content stats for the space-details screen — a CLIENT-SIDE
 * computed snapshot, since Starfish exposes no metadata/size endpoint (pull only
 * returns `{ data, hash, ts }`, and a private space is ciphertext to the server).
 *
 * Room count is free (the registry). Everything else is a fan-out: pull + decrypt
 * every room of the space and fold its append-only log. The decrypt branching mirrors
 * `notification-preview.ts` (private vs public) — NOT `cross-room.ts:loadAllMessages`,
 * which skips public rooms and would silently undercount.
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
import { buildSpaceEncryptor } from '../starfish/space-encryptor';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';


import { resolveEdit, type StoredMsg } from '../format/message-view';
import { makeClient } from '../starfish/client';
import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull, pubstreamRoomPull, streamRoomPull } from '../starfish/paths';
import { isPublicSpaceId, publicSpaceAuth, readPublicRoomsDoc } from '../starfish/pubspace';
import { pullAndFold } from '../messaging/stream-log';
import { buildThreadDigest } from '../messaging/threads';
import type { MessageEditEvent, Room } from '../domain/types';

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

interface RoomLog {
  messages: StoredMsg[];
  edits: MessageEditEvent[];
  /** Byte size of the room's stored document(s); excludes attachment blobs. */
  docBytes: number;
}

/** JSON byte length (char-length is exact for base64 ciphertext envelopes). */
const byteLen = (doc: unknown): number => JSON.stringify(doc ?? null).length;

// ── per-room fold: every room is an append-only log (private decrypts, public plain) ──

/** Pull + fold one room's whole append-only log via the shared {@link pullAndFold}, then
 *  size it from the RAW elements. Lets a pull failure THROW so `loadSpaceStats` can flag
 *  the snapshot `partial` (an unreadable room is an undercount, not a silent zero). */
async function roomLog(client: StarfishClient, enc: Encryptor | null, pullPath: string): Promise<RoomLog> {
  const { data, items } = await pullAndFold(client, enc, pullPath);
  // An empty / not-yet-created log occupies no space (don't count the bare `[]`/`null`).
  return { messages: data.messages, edits: data.edits, docBytes: items.length ? byteLen(items) : 0 };
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
    // Every room is an append-only log now; public rooms are plaintext (no encryptor).
    foldRoom = (room) => roomLog(client, null, pubstreamRoomPull(auth.ownerId, spaceId, room.id));
  } else {
    const space = await buildSpaceEncryptor(session, spaceId);
    if (!space) {
      // No keyring for this space yet — the room list now lives in the ENCRYPTED index,
      // so without a keyring we can't even count rooms. Report an empty (non-partial)
      // snapshot rather than a misleading count.
      return stats;
    }
    const { client, enc } = space;
    rooms = (await readIndexRooms(client, enc, objIndexPull(spaceId), spaceId).catch(() => null))?.rooms ?? [];
    // Every room is an append-only log now; private rooms decrypt with the space encryptor.
    foldRoom = (room) => roomLog(client, enc, streamRoomPull(room.id));
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
