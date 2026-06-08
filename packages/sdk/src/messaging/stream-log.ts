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
import type { AppendElement, Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { MessageEditEvent, PinEvent, ReactionEvent } from '../domain/types';
import type { StoredMsg } from '../format/message-view';
import { kvGet } from '../config/adapters';

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
 *  change can bump the version rather than mis-read stale blobs. NOT user-scoped: the
 *  persisted blob is `cursor.getItems()` under `persistEncrypted` — the CIPHERTEXT
 *  envelopes for a private room (E2EE-safe at rest, decryptable only by a keyring holder)
 *  and already-public plaintext for a public room — so the roomId alone namespaces it.
 *  `v2`: bumped from v1, which (without `persistEncrypted`) stored DECRYPTED elements; a
 *  v1 blob is plaintext and must NOT be fed to the now-ciphertext-expecting cursor. */
export const streamLogKey = (roomId: string): string => `octochat.streamlog.v2.${roomId}`;

/** Tolerant load of a persisted append log — bad/absent/wrong-shaped JSON yields `[]`
 *  (a corrupt blob must never brick the room; the next `pull` just refetches the log).
 *  These envelopes warm-start the cursor as `initialItems` so history paints instantly
 *  on open before any network round-trip. */
export async function loadStreamLog(roomId: string): Promise<AppendElement[]> {
  const raw = await kvGet(streamLogKey(roomId));
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
