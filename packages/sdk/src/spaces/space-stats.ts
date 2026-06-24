/**
 * Space-size & content stats for the space-details screen — a CLIENT-SIDE
 * computed snapshot, since Starfish exposes no metadata/size endpoint (pull only
 * returns `{ data, hash, ts }`, and a private space is ciphertext to the server).
 *
 * Room count is free (the object index). Everything else is a fan-out: pull every
 * room of the space and fold its append-only log. Per-room access is resolved via
 * `buildNodeAccess` — enc rooms get a decryptor; plaintext rooms (public/invite) get
 * null. Public rooms are read via `streamPubRoomPull`; all others via `streamRoomPull`.
 *
 * Semantics worth knowing (they differ on purpose):
 *  - `messages` is NET OF DELETES (a tombstoned message is folded out, matching what
 *    the user sees in-room).
 *  - `attachments` counts attachments on ALL messages incl. deleted — the sealed blob
 *    stays in storage after a delete tombstone, so it still occupies space.
 *  - `bytes` is APPROXIMATE: the JSON byte length of each room's stored doc plus the
 *    plaintext size of each attachment. It is NOT the server's on-disk figure.
 */
import { getSpaceClient } from '@drakkar.software/starfish-spaces';
import { buildNodeAccessShared } from '../starfish/node-access-cache';

import { resolveEdit, type StoredMsg } from '../format/message-view';
import type { Session } from '../starfish/identity';
import { roomStreamPull } from '../messaging/room-paths';
import { foldRoomCached } from '../messaging/stream-log';
import { listSpaceRooms } from '../messaging/cross-room';
import { buildThreadDigest } from '../messaging/threads';
import type { MessageEditEvent, Room } from '../domain/types';

export interface SpaceStats {
  /** Rooms/channels in the space (from the index). */
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
 * Compute the size + content stats for a space. A snapshot: one pull per room,
 * so cost scales with the space. Failures per room set `partial` and are skipped
 * rather than blanking the whole result.
 */
export async function loadSpaceStats(session: Session, spaceId: string): Promise<SpaceStats> {
  const stats: SpaceStats = { rooms: 0, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: false };

  const client = getSpaceClient(spaceId, session);
  // Object index is always plaintext — listSpaceRooms coalesces concurrent callers.
  // A network failure on the index read returns partial:true rather than an empty snapshot
  // so the caller can distinguish "unreachable" from "genuinely empty space".
  let rooms: Room[];
  try {
    rooms = await listSpaceRooms(client, spaceId);
  } catch {
    return { ...stats, partial: true };
  }

  stats.rooms = rooms.length;
  for (const room of rooms) {
    try {
      // Soft-open per-room access: enc rooms get a decryptor; plaintext get null.
      const access = await buildNodeAccessShared(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
      // foldRoomCached warm-starts from kv and pulls incrementally (no full=true re-pull).
      // Let a pull failure THROW so we can flag the snapshot `partial`.
      const { data, items } = await foldRoomCached(
        session.userId,
        access?.client ?? client,
        access?.encryptor ?? null,
        room.id,
        roomStreamPull(room, room.id),
      );
      accumulate(stats, { messages: data.messages, edits: data.edits, docBytes: items.length ? byteLen(items) : 0 }, session.userId);
    } catch {
      stats.partial = true; // room unreadable — totals undercount
    }
  }
  return stats;
}
