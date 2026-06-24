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
import { AppendLogCursor } from '@drakkar.software/starfish-client';
import type { AppendElement, Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { MessageEditEvent, PinEvent, ReactionEvent } from '../domain/types';
import type { StoredMsg } from '../format/message-view';
import { kvGet, kvSet } from '../config/adapters';

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
// incremental pull → persist back when the cursor grew. Two extra guards mirror
// `dm-activity.ts`'s pattern: per-key in-flight coalescing (a focus burst that
// starts threads + pins + nav + digest simultaneously issues ONE network pull, not N),
// and a short TTL cache so a re-focus within the window is free.
//
// Cache-key includes whether enc is present so a user gaining enc access mid-session
// doesn't receive the prior plaintext result.

/** How long a successfully-folded result is reused without a network round-trip. */
const FOLD_CACHE_TTL = 10_000;

const _foldInflight = new Map<string, Promise<FoldedLog>>();
const _foldCache = new Map<string, { result: FoldedLog; ts: number }>();

/**
 * Warm-start aware room-log fold for cross-room sweeps.
 *
 * Warm-starts from `streamlog.v2` kv → builds an AppendLogCursor (so the first pull
 * is incremental `?checkpoint=` rather than `?full=true`) → persists back when the
 * cursor grew → caches the result for {@link FOLD_CACHE_TTL} ms per `userId.roomId`.
 *
 * A room truly never opened on this device still cold-starts once (kv miss → full pull);
 * every subsequent call within the TTL window or before the in-flight resolves is free.
 */
export async function foldRoomCached(
  userId: string,
  client: StarfishClient,
  enc: Encryptor | null,
  roomId: string,
  pullPath: string,
): Promise<FoldedLog> {
  const key = `${userId}.${roomId}.${enc !== null ? '1' : '0'}`;

  // TTL hit: return stale-while-still-fresh result (absorbs focus bursts).
  const hit = _foldCache.get(key);
  if (hit && Date.now() - hit.ts < FOLD_CACHE_TTL) return hit.result;

  // Coalesce: join an already-in-flight fold for this room.
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
    const [decrypted] = await Promise.all([
      cursor.getDecryptedItems(),
      // Persist back when the item count changed (grow OR shrink). A shrinking log
      // (server compaction/purge) would otherwise leave a stale oversized blob that
      // seeds phantom messages; skip the write entirely when nothing changed so a
      // warm room swept after TTL expiry doesn't re-serialize and rewrite the blob.
      items.length !== initialItems.length
        ? kvSet(streamLogKey(userId, roomId), JSON.stringify(items)).catch(() => {})
        : Promise.resolve(),
    ]);
    const result: FoldedLog = { data: fanOut(decrypted), items };
    _foldCache.set(key, { result, ts: Date.now() });
    return result;
  })();

  _foldInflight.set(key, p);
  void p.finally(() => _foldInflight.delete(key));
  return p;
}

/** Clear all cached folds — call on sign-out alongside `resetDmHeads`. */
export function resetFoldRoomCache(): void {
  _foldInflight.clear();
  _foldCache.clear();
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
