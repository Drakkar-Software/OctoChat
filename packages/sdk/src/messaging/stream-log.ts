/**
 * Append-log machinery for rooms — the headless half of the app's `useRoom` hook (and
 * its read-only cousins: cross-room search/threads/pins, space stats, notification
 * preview). Every room is an append-only log: each post is a single `client.append`
 * (no pull/merge/hash/conflict), so one log carries messages, reactions, edits and pins
 * as typed {@link StreamEnvelope}s. These helpers fold a decrypted batch into the typed
 * arrays the chat store holds ({@link fanOut}), pull+fold a whole room ({@link pullAndFold}),
 * dedup by id, and warm-start the cursor from kv across restarts. The hook owns the cursor
 * + store; this module owns the data shaping, the shared pull/fold, and the persistence keys.
 */
import { AppendLogCursor, checkpointOf, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { AppendElement, BatchPullEntry, Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { getSpaceClient } from '@drakkar.software/starfish-spaces';

import type { MessageEditEvent, PinEvent, ReactionEvent, Room } from '../domain/types';
import type { StoredMsg } from '../format/message-view';
import { kvGet, kvSet } from '../config/adapters';
import type { Session } from '../starfish/identity';
import { buildNodeAccessShared } from '../starfish/node-access-cache';
import { roomStreamPull } from './room-paths';

/** One append-log element: a typed envelope so a single log carries messages,
 *  reactions and edits. `t` discriminates; `e` is the payload (a StoredMsg /
 *  ReactionEvent / MessageEditEvent / PinEvent). Sealed as a whole for private streams. */
export type StreamEnvelope =
  | { t: 'msg'; e: StoredMsg }
  | { t: 'reaction'; e: ReactionEvent }
  | { t: 'edit'; e: MessageEditEvent }
  | { t: 'pin'; e: PinEvent };

export interface StreamData {
  messages: StoredMsg[];
  reactions: ReactionEvent[];
  edits: MessageEditEvent[];
  pins: PinEvent[];
}

/** Append `incoming` after `existing`, dropping any element whose `id` is already
 *  present. Preserves order (existing first, then the new tail) so the message list
 *  stays in append (ts-ascending) order, and returns `existing` unchanged when nothing
 *  new is added so an idle delta pull triggers no re-render. This dedup is the guard for
 *  a focus+SSE double-pull racing on the same checkpoint — no in-flight lock needed. */
export function concatDedupById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((x) => x.id));
  const added: T[] = [];
  for (const x of incoming) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    added.push(x);
  }
  return added.length === 0 ? existing : [...existing, ...added];
}

/** Cross-restart persistence key for a room's append log. Versioned so a persist-format
 *  change can bump the version rather than mis-read stale blobs. User-scoped: without the
 *  userId prefix, switching A→B on a shared device would cold-start B's room view from A's
 *  persisted ciphertext envelopes (privacy smell; B decrypts only if already a member of
 *  the same space, but A's at-rest ciphertext must never linger under B's session). Keying
 *  by `userId.roomId` makes B's lookup for the same roomId miss A's blob by construction.
 *  `v2`: bumped from v1, which (without `persistEncrypted`) stored DECRYPTED elements; a
 *  v1 blob is plaintext and must NOT be fed to the now-ciphertext-expecting cursor. */
export const streamLogKey = (userId: string, roomId: string): string =>
  `octochat.streamlog.v2.${userId}.${roomId}`;

/** Tolerant load of a persisted append log — bad/absent/wrong-shaped JSON yields `[]`
 *  (a corrupt blob must never brick the room; the next `pull` just refetches the log).
 *  These envelopes warm-start the cursor as `initialItems` so history paints instantly
 *  on open before any network round-trip. */
export async function loadStreamLog(userId: string, roomId: string): Promise<AppendElement[]> {
  const raw = await kvGet(streamLogKey(userId, roomId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppendElement[]) : [];
  } catch {
    return [];
  }
}

/** Fan a batch of DECRYPTED append elements into the four typed arrays the chat store
 *  holds. Each element's `data` is a {@link StreamEnvelope} (the cursor already decrypted
 *  it and applied the skip policy, so no per-element try/catch here); `t` discriminates
 *  msg/reaction/edit/pin. The server-assigned `ts` is the authoritative order/time, so
 *  stamp it onto any payload that didn't carry its own. Shared by the warm-start hydrate
 *  (full persisted log) and the delta merge (just the new `pull` batch). */
export function fanOut(items: AppendElement[]): StreamData {
  const messages: StoredMsg[] = [];
  const reactions: ReactionEvent[] = [];
  const edits: MessageEditEvent[] = [];
  const pins: PinEvent[] = [];
  for (const item of items) {
    const env = item.data as unknown as StreamEnvelope;
    if (!env) continue;
    if (env.t === 'msg') messages.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env.t === 'reaction') reactions.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env.t === 'edit') edits.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env.t === 'pin') pins.push({ ...env.e, ts: env.e.ts || item.ts });
  }
  return { messages, reactions, edits, pins };
}

/** The folded log plus the RAW pulled elements (callers that size storage read `items`). */
export interface FoldedLog {
  data: StreamData;
  items: AppendElement[];
  /** Set by {@link batchFoldSpaceRooms} when this room's fold failed even after the
   *  per-room fallback (unreadable / unreachable) — an empty `data`/`items` here means
   *  "undercount", not "genuinely empty". Absent (or `false`) everywhere else. */
  failed?: boolean;
}

/**
 * Pull a room's append-only log and fold it via {@link fanOut} — THE one place the
 * pull→decrypt→fold sequence lives (shared by the room hook's cousins: cross-room search/
 * threads/pins, space stats, and the notification preview, which used to each inline it).
 *
 * A PRIVATE room passes its space `encryptor`: every element's `data` is decrypted, and a
 * single element that fails (keyring skew / foreign / corrupt) is SKIPPED so one poison
 * element never blanks the room. A PUBLIC room passes `enc: null` and the plaintext
 * envelope is read directly. Returns the folded {@link StreamData} AND the raw `items`.
 *
 * The pull itself is NOT caught here — the caller picks the policy: swallow to empty
 * (search), let it throw (stats → mark `partial`), or map to null (preview). `pullOpts`
 * defaults to the whole log (`full`); pass `{ appendField:'items', last: K }` for a
 * bounded tail (e.g. a preview that only needs the latest line).
 */
// ── Cached room-fold for cross-room sweeps ───────────────────────────────────────
// Used by `cross-room.ts`, `space-stats.ts`, and `use-space-digest`. Unlike
// `pullAndFold` (which always cold-starts with `full:true`), this helper mirrors
// what `useRoom`'s AppendLogCursor does: warm-start from the persisted kv blob →
// incremental pull → persist back unconditionally (mirrors useRoom, ensures empty
// rooms write a kv checkpoint so the NEXT pull is incremental rather than full).
// Per-key in-flight coalescing (mirrors `dm-activity.ts`'s pattern) collapses a
// focus burst that starts threads + pins + nav + digest simultaneously into ONE
// network pull per room, not N. No TTL: each non-overlapping call does an incremental
// delta pull (cheap, usually empty) → always fresh.
//
// Cache key includes enc AND pullPath so two callers with different paths or enc state
// for the same room don't coalesce onto the wrong cursor.

const _foldInflight = new Map<string, Promise<FoldedLog>>();

/**
 * Warm-start aware room-log fold for cross-room sweeps.
 *
 * Warm-starts from `streamlog.v2` kv → builds an AppendLogCursor (so the first pull
 * is incremental `?checkpoint=` rather than `?full=true`) → persists back so future
 * pulls are incremental too. In-flight coalescing ensures a focus burst that triggers
 * threads + pins + nav + digest simultaneously shares ONE network pull per room.
 *
 * A room truly never opened on this device still cold-starts once (kv miss → full pull);
 * every concurrent call before the in-flight resolves is free.
 */
export async function foldRoomCached(
  userId: string,
  client: StarfishClient,
  enc: Encryptor | null,
  roomId: string,
  pullPath: string,
): Promise<FoldedLog> {
  const key = `${userId}.${roomId}.${enc !== null ? '1' : '0'}.${pullPath}`;

  // Coalesce: join an already-in-flight fold for this room+path.
  const pending = _foldInflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<FoldedLog> => {
    const initialItems = await loadStreamLog(userId, roomId);
    const cursor = new AppendLogCursor({
      client,
      pullPath,
      appendField: 'items',
      onElementError: 'skip',
      initialItems,
      // Keep getItems() as ciphertext envelopes for a private room (same as useRoom).
      ...(enc ? { encryptor: enc, persistEncrypted: true } : {}),
    });
    // Incremental when warm (checkpoint > 0); full only on a true cold start.
    await cursor.pull();
    const items = cursor.getItems();
    // kvSet (kv write) and getDecryptedItems (in-memory crypto) are independent —
    // run them in parallel so decryption doesn't wait for the storage round-trip.
    // Write unconditionally (mirrors useRoom) so empty rooms establish a kv checkpoint
    // and future pulls are incremental rather than full=true re-fetches.
    const [decrypted] = await Promise.all([
      cursor.getDecryptedItems(),
      kvSet(streamLogKey(userId, roomId), JSON.stringify(items)).catch(() => {}),
    ]);
    return { data: fanOut(decrypted), items };
  })();

  _foldInflight.set(key, p);
  void p.finally(() => _foldInflight.delete(key));
  return p;
}

/** Clear all in-flight folds — call on sign-out alongside `resetDmHeads`. */
export function resetFoldRoomCache(): void {
  _foldInflight.clear();
  _batchFoldInflight.clear();
}

export async function pullAndFold(
  client: StarfishClient,
  enc: Encryptor | null,
  pullPath: string,
  pullOpts: Record<string, unknown> = { appendField: 'items', full: true },
): Promise<FoldedLog> {
  // `appendField` makes the server return the element array; the dynamic `pullOpts` hides
  // that from the overload picker (it resolves to the base `PullResult`), so cast through
  // unknown to the append-element shape the caller asked for.
  const items = ((await client.pull(pullPath, pullOpts)) ?? []) as unknown as AppendElement[];
  if (!enc) return { data: fanOut(items), items };
  const decrypted: AppendElement[] = [];
  for (const item of items) {
    try {
      decrypted.push({ ...item, data: (await enc.decrypt(item.data)) as Record<string, unknown> });
    } catch {
      /* a single undecryptable element must not blank the whole room */
    }
  }
  return { data: fanOut(decrypted), items };
}

// ── Batch fold for a whole space's rooms ─────────────────────────────────────────
// `objlog` (private/E2EE + invite+enc) and `objpublog` (public) are both covered by
// the space client's single `spaceMemberScope` cap, and both collections are
// `appendOnly` server-side — so a whole space's room logs collapse into ONE
// `/batch/pull` (one call per ~90-room chunk) instead of one `pull` per room.
// `objinvlog` (invite+PLAINTEXT) is excluded: it's gated by its own per-node cap,
// not the space cap, so those rooms keep the existing per-room `foldRoomCached` path.
//
// Only the NETWORK PULL is batched — decryption stays per-room via
// `buildNodeAccessShared` (memoized: one keyring pull per space for regular private
// rooms, one per node for invite+enc rooms, a no-op for plaintext), so ciphertext
// isolation between rooms is unchanged.

/** Rooms per `/batch/pull` chunk. Each room contributes exactly one param-set (to
 *  either `objlog` or `objpublog`), so this stays under the server's ~100-entry
 *  `max_collections_per_batch` with margin (mirrors `CROSS_SPACE_CHUNK_SIZE`). */
const ROOM_BATCH_CHUNK_SIZE = 90;

const _batchFoldInflight = new Map<string, Promise<Map<string, FoldedLog>>>();

type RoomAccess = { client: StarfishClient; encryptor: Encryptor | null } | null;

/** Resolve each room's per-node access via the memoized cache — cheap even across
 *  a full space's rooms (one real keyring pull per space, or per invite node). */
async function resolveRoomAccess(
  session: Session,
  spaceId: string,
  rooms: Room[],
): Promise<Map<string, RoomAccess>> {
  const map = new Map<string, RoomAccess>();
  await Promise.all(
    rooms.map(async (room) => {
      const access = await buildNodeAccessShared(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
      map.set(room.id, access);
    }),
  );
  return map;
}

/** Fold one room from a batch entry: merge with the persisted ciphertext log,
 *  decrypt (tolerating a single poison element), and persist the merged raw items
 *  back to kv. Falls back to a direct per-room pull when the entry is missing or
 *  the server reports a per-entry error, so one bad room doesn't drop from the sweep. */
async function mergeRoomEntry(
  session: Session,
  spaceId: string,
  room: Room,
  entry: BatchPullEntry | undefined,
  initialItems: AppendElement[],
  access: RoomAccess,
  fallbackClient: StarfishClient,
): Promise<FoldedLog> {
  if (!entry || entry.error) {
    return foldRoomCached(
      session.userId,
      access?.client ?? fallbackClient,
      access?.encryptor ?? null,
      room.id,
      roomStreamPull(room, room.id),
    ).catch(() => ({ data: fanOut([]), items: [], failed: true }));
  }

  const newItems = Array.isArray((entry.data as { items?: unknown } | undefined)?.items)
    ? ((entry.data as { items: AppendElement[] }).items)
    : [];
  const merged = [...initialItems, ...newItems];

  const enc = access?.encryptor ?? null;
  let decrypted: AppendElement[];
  if (!enc) {
    decrypted = merged;
  } else {
    decrypted = [];
    for (const item of merged) {
      try {
        decrypted.push({ ...item, data: (await enc.decrypt(item.data)) as Record<string, unknown> });
      } catch {
        /* a single undecryptable element must not blank the whole room */
      }
    }
  }

  // Persist merged raw (ciphertext or plaintext) items unconditionally — mirrors
  // foldRoomCached, establishing a kv checkpoint even for an empty delta.
  void kvSet(streamLogKey(session.userId, room.id), JSON.stringify(merged)).catch(() => {});
  return { data: fanOut(decrypted), items: merged };
}

/** Batch-pull + fold one chunk of a space's rooms, writing every result into `out`. */
async function foldRoomChunk(
  session: Session,
  spaceId: string,
  client: StarfishClient,
  chunk: Room[],
  out: Map<string, FoldedLog>,
): Promise<void> {
  const accessByRoom = await resolveRoomAccess(session, spaceId, chunk);
  const initialByRoom = new Map<string, AppendElement[]>();
  await Promise.all(
    chunk.map(async (room) => {
      initialByRoom.set(room.id, await loadStreamLog(session.userId, room.id));
    }),
  );

  const objlogRooms = chunk.filter((r) => r.access !== 'public');
  const pubRooms = chunk.filter((r) => r.access === 'public');

  const collections: string[] = [];
  const params: Record<string, Record<string, string>[]> = {};
  const appendParams: Record<string, { appendField: string; since: number }[]> = {};
  for (const [name, group] of [['objlog', objlogRooms], ['objpublog', pubRooms]] as const) {
    if (group.length === 0) continue;
    collections.push(name);
    params[name] = group.map((r) => ({ spaceId, roomId: r.id }));
    appendParams[name] = group.map((r) => ({
      appendField: 'items',
      since: checkpointOf(initialByRoom.get(r.id) ?? []),
    }));
  }

  let batchCollections: Record<string, BatchPullEntry[]>;
  try {
    batchCollections = (await client.batchPull(collections, { params, appendParams })).collections;
  } catch (err) {
    // 429: do not amplify load — rethrow so the caller's cooldown/cache path absorbs it.
    if (err instanceof StarfishHttpError && err.status === 429) throw err;
    // Any other error (old server, network failure): degrade to per-room folds.
    await Promise.all(
      chunk.map(async (room) => {
        const folded = await foldRoomCached(
          session.userId,
          accessByRoom.get(room.id)?.client ?? client,
          accessByRoom.get(room.id)?.encryptor ?? null,
          room.id,
          roomStreamPull(room, room.id),
        ).catch(() => ({ data: fanOut([]), items: [], failed: true }));
        out.set(room.id, folded);
      }),
    );
    return;
  }

  await Promise.all([
    ...objlogRooms.map((room, i) =>
      mergeRoomEntry(
        session, spaceId, room, batchCollections['objlog']?.[i], initialByRoom.get(room.id) ?? [],
        accessByRoom.get(room.id) ?? null, client,
      ).then((folded) => out.set(room.id, folded)),
    ),
    ...pubRooms.map((room, i) =>
      mergeRoomEntry(
        session, spaceId, room, batchCollections['objpublog']?.[i], initialByRoom.get(room.id) ?? [],
        accessByRoom.get(room.id) ?? null, client,
      ).then((folded) => out.set(room.id, folded)),
    ),
  ]);
}

/**
 * Batch-pull + fold ALL of a space's rooms in as few HTTP round-trips as possible —
 * the batch-aware sibling of {@link foldRoomCached}, used by the cross-room sweeps
 * (`forEachSpaceRoom`, `loadSpaceStats`) instead of one `pull` per room.
 *
 * `objinvlog` (invite+plaintext) rooms are excluded from the batch (per-node cap,
 * not the space cap) and fold individually via `foldRoomCached`.
 *
 * Per-space in-flight coalescing: concurrent calls for the same space (the
 * threads+pins+nav+digest focus burst, which all derive `rooms` from the same
 * coalesced `listSpaceRooms` call) share ONE batch rather than one each.
 */
export async function batchFoldSpaceRooms(
  session: Session,
  spaceId: string,
  rooms: Room[],
): Promise<Map<string, FoldedLog>> {
  if (rooms.length === 0) return new Map();

  const key = `${session.userId}.${spaceId}`;
  const pending = _batchFoldInflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<Map<string, FoldedLog>> => {
    const client = getSpaceClient(spaceId, session);
    const out = new Map<string, FoldedLog>();

    const batchable: Room[] = [];
    const inviteOnly: Room[] = [];
    for (const room of rooms) {
      if (room.access === 'invite' && !room.enc) inviteOnly.push(room);
      else batchable.push(room);
    }

    for (let i = 0; i < batchable.length; i += ROOM_BATCH_CHUNK_SIZE) {
      await foldRoomChunk(session, spaceId, client, batchable.slice(i, i + ROOM_BATCH_CHUNK_SIZE), out);
    }

    await Promise.all(
      inviteOnly.map(async (room) => {
        const access = await buildNodeAccessShared(session, spaceId, room.id, { enc: room.enc }).catch(() => null);
        const folded = await foldRoomCached(
          session.userId,
          access?.client ?? client,
          access?.encryptor ?? null,
          room.id,
          roomStreamPull(room, room.id),
        ).catch(() => ({ data: fanOut([]), items: [], failed: true }));
        out.set(room.id, folded);
      }),
    );

    return out;
  })();

  _batchFoldInflight.set(key, p);
  // `p` itself is returned to the caller (who is expected to handle a rejection, e.g.
  // a 429 rethrow) — but this SEPARATE `.finally()` chain derives its own promise, which
  // would otherwise surface as an unhandled rejection when `p` rejects. Swallow it here;
  // the cleanup (map delete) still runs regardless of outcome.
  p.finally(() => _batchFoldInflight.delete(key)).catch(() => {});
  return p;
}
