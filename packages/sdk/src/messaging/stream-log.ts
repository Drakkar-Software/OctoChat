/**
 * Pure append-log machinery for STREAM rooms — the headless half of the app's
 * `useStreamRoom` hook. A stream room is an append-only log: every post is a single
 * `client.append` (no pull/merge/hash/conflict), so a single log carries messages,
 * reactions, edits and pins as typed {@link StreamEnvelope}s. These helpers fold a
 * decrypted batch into the typed arrays the chat store holds, dedup by id, and warm-
 * start the cursor from kv across restarts. No React, no platform lock-in — the hook
 * owns the cursor + store; this module owns the data shaping and the persistence keys.
 */
import type { AppendElement } from '@drakkar.software/starfish-client';

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

/** Cross-restart persistence key for a room's append log. Versioned so a future
 *  envelope/shape change can bump `v1` rather than mis-read stale blobs. NOT
 *  user-scoped: the persisted blob is `cursor.getItems()` — the CIPHERTEXT envelopes
 *  for a private room (E2EE-safe at rest, decryptable only by a keyring holder) and
 *  already-public plaintext for a public room — so the roomId alone namespaces it. */
export const streamLogKey = (roomId: string): string => `octochat.streamlog.v1.${roomId}`;

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
