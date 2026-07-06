/**
 * Cross-room reads for search + threads: open the right client + encryptor per room
 * and flatten their messages. Rooms never accessed have no keyring cached and are simply
 * skipped (buildNodeAccess returns null).
 *
 * Every room is an APPEND-ONLY log now, so each reader folds a room's log via
 * {@link foldRoomCached} — which warm-starts from the local kv blob (written by `useRoom`
 * after each visit), pulls only the incremental delta, and coalesces concurrent calls.
 * A room truly never opened on this device still cold-starts once; concurrent calls within
 * one burst share a single in-flight fold per room.
 *
 * Space-level metadata reads (`_index`, `_access`) are coalesced via in-flight maps so
 * threads + pins + nav + digest — which all fire simultaneously on focus — share ONE
 * `_index` read and ONE `_access` read per space burst, not one each.
 *
 * Stream path routing by `room.access`/`room.enc` (projected from the index):
 *   public  → `streamPubRoomPull` (plaintext, no encryptor)
 *   space/invite + enc:true  → `streamRoomPull` (E2EE, space keyring)
 *   space/invite + enc:false → `streamRoomPull` (member-gated plaintext)
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { getSpaceClient } from '@drakkar.software/starfish-spaces';
import { buildNodeAccessShared } from '../starfish/node-access-cache';

import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull } from '../starfish/paths';
import { roomStreamPull } from './room-paths';
import { readSpaceAccess } from '../starfish/registry';
import type { StoredMsg } from '../format/message-view';
import { fanOut, foldRoomCached, type StreamData } from './stream-log';
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

// ── Space-level metadata coalescing (Tier 2) ─────────────────────────────────────
// Concurrent sweeps (threads + pins + nav + digest) fire simultaneously on focus.
// Without coalescing they each pull `_index` and `_access` separately — one extra HTTP
// round-trip per sweep. In-flight coalescing collapses a burst of concurrent requests
// for the same space into a single network call; sequential calls (different focus events)
// each get fresh data.

const _indexInflight = new Map<string, Promise<Room[]>>();
const _accessInflight = new Map<string, Promise<{ owner: string | null }>>();

/** Pull the space's object index and return its room list — coalesced per spaceId burst. */
async function listSpaceRooms(client: StarfishClient, spaceId: string): Promise<Room[]> {
  const pending = _indexInflight.get(spaceId);
  if (pending) return pending;
  const p = readIndexRooms(client, null, objIndexPull(spaceId), spaceId)
    .then((r) => r?.rooms ?? [])
    .finally(() => _indexInflight.delete(spaceId));
  _indexInflight.set(spaceId, p);
  return p;
}

/** Pull the space's access doc and return the owner — coalesced per spaceId burst. */
async function getSpaceOwner(client: StarfishClient, spaceId: string, session: Session): Promise<{ owner: string | null }> {
  const pending = _accessInflight.get(spaceId);
  if (pending) return pending;
  const p = readSpaceAccess(client, spaceId, session)
    .then(({ owner }) => ({ owner: owner ?? null }))
    .finally(() => _accessInflight.delete(spaceId));
  _accessInflight.set(spaceId, p);
  return p;
}

// Export so callers can expose it on `listSpaceRooms` for `space-stats.ts`.
export { listSpaceRooms };

/** Drop all in-flight space-level metadata — call on sign-out alongside resetFoldRoomCache. */
export function resetSpaceLevelMetaCache(): void {
  _indexInflight.clear();
  _accessInflight.clear();
}

/** Soft-open a room's per-node access (enc rooms get a decryptor; plaintext → null;
 *  a never-opened room → fall back to the space client) and fold its log via the
 *  cached warm-start path. */
async function foldRoom(
  session: Session,
  spaceId: string,
  fallbackClient: StarfishClient,
  room: Room,
): Promise<StreamData> {
  const access = await buildNodeAccessShared(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
  return foldRoomCached(
    session.userId,
    access?.client ?? fallbackClient,
    access?.encryptor ?? null,
    room.id,
    roomStreamPull(room, room.id),
  ).then((r) => r.data).catch(() => fanOut([]));
}

/** Open the space client, list its rooms, fold each room's log via the cached path,
 *  and flat-map `collect` across them. The shared scaffold behind the cross-room sweeps;
 *  only the per-room projection differs.
 *
 *  Rooms are folded with a 5-worker bounded pool (NOT unbounded Promise.all) so a space
 *  with many rooms doesn't burst N concurrent objlog pulls and risk 429s. foldRoomCached's
 *  in-flight coalescing collapses duplicate rooms across simultaneous cross-room sweeps
 *  (threads + pins + nav + digest) into a single network pull each. Room order is
 *  preserved: each slot is written by index then flattened in order. */
async function forEachSpaceRoom<T>(
  session: Session,
  spaceId: string,
  collect: (room: Room, log: StreamData) => T[],
): Promise<T[]> {
  const client = getSpaceClient(spaceId, session);
  const rooms = await listSpaceRooms(client, spaceId);
  const slots: T[][] = Array.from({ length: rooms.length });
  const CONCURRENCY = 5;
  const queue = rooms.map((r, i) => [r, i] as [Room, number]);
  const workers = Array.from({ length: Math.min(CONCURRENCY, rooms.length) }, async () => {
    let entry: [Room, number] | undefined;
    while ((entry = queue.shift()) !== undefined) {
      const [room, idx] = entry;
      try {
        slots[idx] = collect(room, await foldRoom(session, spaceId, client, room));
      } catch {
        slots[idx] = []; // one failing room must not abort the sweep
      }
    }
  });
  await Promise.all(workers);
  return slots.flat();
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
  // `owner` (the only pin authority) lives in the `_access` registry.
  // Coalesced so a simultaneous threads+pins+nav burst shares one `_access` read.
  const client = getSpaceClient(spaceId, session);
  const { owner } = await getSpaceOwner(client, spaceId, session);
  if (!owner) return [];

  // Fold each room via the shared scaffold (5-worker pool, in-flight coalescing).
  // collect returns the room's pinned entries so forEachSpaceRoom can flatten them.
  type PinEntry = { room: Room; msg: StoredMsg; pinnedTs: number };
  const entries = await forEachSpaceRoom(session, spaceId, (room, log): PinEntry[] => {
    const latest = new Map<string, (typeof log.pins)[number]>();
    for (const p of log.pins) {
      if (p.userId !== owner) continue;
      const cur = latest.get(p.msgId);
      if (!cur || p.ts > cur.ts) latest.set(p.msgId, p);
    }
    const byId = new Map(log.messages.map((m) => [m.id, m]));
    const result: PinEntry[] = [];
    for (const [msgId, ev] of latest) {
      if (ev.kind !== 'pin') continue;
      const msg = byId.get(msgId);
      if (msg) result.push({ room, msg, pinnedTs: ev.ts });
    }
    return result;
  });
  return entries.sort((a, b) => b.pinnedTs - a.pinnedTs).map(({ room, msg }) => ({ room, msg }));
}
