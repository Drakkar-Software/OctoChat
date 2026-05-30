/**
 * Per-identity READ MARKS — the epoch-ms instant each room was last read. Synced so
 * the unread badge / divider clears on EVERY one of a user's devices, not only the one
 * that opened the room.
 *
 * Two tiers, mirroring `mutes.ts`: the durable source of truth is the user's own synced
 * `_spaces` doc (a `reads` key alongside `spaces`/`caps`/`mutes`, see `registry.ts`),
 * which a fresh device re-hydrates from its seed; the platform kv (web localStorage /
 * native AsyncStorage) is a fast, offline cache. Kept as a module-level snapshot so the
 * unread provider can read it synchronously, while React consumers subscribe.
 *
 * Two differences from mutes — both because a read mark is high-frequency and monotonic
 * (it changes on every room open, and only ever advances):
 *   1. Writes are COALESCED behind a short debounce, then flushed as one whole-cache
 *      push (mutes push immediately on each rare toggle).
 *   2. Merges take the MAX per room, never overwrite — so a stale device's flush can't
 *      roll back a newer mark another device already pushed. This holds on `hydrateReads`
 *      (local un-flushed marks survive a server read) and in the `updateReadsDoc` mutator.
 */
import type { ReadPrefs } from '@/lib/types';

import type { Session } from './starfish/identity';
import { updateReadsDoc } from './starfish/registry';
import { kvGet, kvSet } from './starfish/kv';

const EMPTY: ReadPrefs = { rooms: {} };
const keyFor = (userId: string) => `octochat.reads.${userId}`;
/** The pre-sync local-only map (`unread-context`'s `lastReadKey`). Folded into the
 *  synced cache on hydrate so existing users keep their marks; superseded thereafter. */
const legacyKeyFor = (userId: string) => `octochat.lastread.${userId}`;

/** How long to wait after the last read before pushing the coalesced batch. Room
 *  opens come in bursts (rapid channel switching); one push per burst, not per open. */
const FLUSH_DELAY_MS = 8_000;

let cache: ReadPrefs = EMPTY;
let activeKey: string | null = null;
let flushSession: Session | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Fold `over` into `base` taking the MAX per room. Returns the SAME `base` reference
 *  when nothing advanced, so callers can detect a no-op by identity. */
function maxMerge(base: ReadPrefs, over: ReadPrefs): ReadPrefs {
  let rooms: Record<string, number> | null = null;
  for (const [id, ts] of Object.entries(over.rooms)) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    if (!(id in base.rooms) || ts > base.rooms[id]) {
      rooms ??= { ...base.rooms };
      rooms[id] = ts;
    }
  }
  return rooms ? { rooms } : base;
}

// ── Synchronous reads (for the non-React unread code paths) ─────────────────────
export function getReadPrefs(): ReadPrefs {
  return cache;
}
/** The viewer's last-read mark for a room (ms); 0 if never read. */
export function getRoomReadAt(roomId: string): number {
  return cache.rooms[roomId] ?? 0;
}

/** Subscribe to snapshot changes (drives `useSyncExternalStore` + the unread reconcile). */
export function subscribeReads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: ReadPrefs): void {
  cache = next;
  for (const l of listeners) l();
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

async function loadReadsKv(key: string): Promise<ReadPrefs> {
  const raw = await kvGet(key);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // The synced cache is `{ rooms }`; the legacy lastread map is a bare `Record`.
    const rooms = (parsed && typeof parsed === 'object' && 'rooms' in (parsed as object)
      ? (parsed as { rooms?: unknown }).rooms
      : parsed) as Record<string, unknown> | undefined;
    if (!rooms || typeof rooms !== 'object') return EMPTY;
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(rooms)) if (typeof v === 'number' && Number.isFinite(v)) out[id] = v;
    return { rooms: out };
  } catch {
    return EMPTY;
  }
}

/** Load this identity's persisted read marks from kv (the synced `octochat.reads` map
 *  max-merged with the legacy `octochat.lastread` map). For the unread provider to seed
 *  its mirror + flip its hydrated gate independent of the async module hydrate. */
export async function loadReadMarksFromKv(userId: string): Promise<Record<string, number>> {
  const [kvReads, legacy] = await Promise.all([loadReadsKv(keyFor(userId)), loadReadsKv(legacyKeyFor(userId))]);
  return maxMerge(kvReads, legacy).rooms;
}

/**
 * Load the active account's read marks into memory. Call (and await) on sign-in and on
 * every re-hydrate (navigation / foreground re-pull). `serverPrefs` comes from the SAME
 * `_spaces` read that hydrates caps/mutes, so the doc isn't pulled twice. Unlike mutes
 * (server-authoritative, wholesale replace), reads MAX-MERGE the server copy with the
 * local kv, any un-flushed in-memory marks, AND the legacy `octochat.lastread` map — a
 * mark only ever advances, so the highest wins and an offline read isn't lost to a sync.
 */
export async function hydrateReads(userId: string, serverPrefs: ReadPrefs): Promise<void> {
  activeKey = keyFor(userId);
  // Fold every source INTO the current cache so an unchanged reconcile returns the same
  // reference (no spurious re-render / kv write — this runs on every navigation now).
  let merged = cache;
  // Read the persisted + legacy marks only on the FIRST hydrate (empty cache, e.g. cold
  // start or post account-switch); afterwards `cache` already dominates kv (it's
  // persisted there), so a per-navigation re-pull just merges the fresh server copy and
  // skips two AsyncStorage reads.
  if (Object.keys(cache.rooms).length === 0) {
    const [kvReads, legacy] = await Promise.all([loadReadsKv(keyFor(userId)), loadReadsKv(legacyKeyFor(userId))]);
    merged = maxMerge(merged, kvReads);
    merged = maxMerge(merged, legacy);
  }
  merged = maxMerge(merged, serverPrefs);
  if (merged === cache) return; // nothing advanced beyond what we already hold
  emit(merged);
  await kvSet(activeKey, JSON.stringify(merged));
}

/** Drop the in-memory marks on account switch / sign-out; leaves disk untouched so the
 *  next {@link hydrateReads} reloads the new user's set. Flush any pending batch FIRST
 *  via {@link flushReadsNow} (the caller does) so a just-read room isn't lost. */
export function resetReads(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  activeKey = null;
  flushSession = null;
  emit(EMPTY);
}

/** Push the whole local cache to the synced doc, max-merged onto fresh server state.
 *  A no-op when nothing in the cache is newer than the server already has. */
async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const session = flushSession;
  if (!session) return;
  // Snapshot the cache NOW — the mutator runs after updateReadsDoc's internal pull
  // (post-await), and a concurrent `resetReads` (sign-out) could clear `cache` before
  // then, which would push an empty doc and drop the just-read room.
  const snapshot = cache;
  await updateReadsDoc(session.accountClient, session.userId, (cur) => {
    const merged = maxMerge(cur, snapshot);
    return merged === cur ? null : merged;
  }).catch((err) => {
    console.error('[OctoChat] reads: failed to sync read marks', err);
  });
}

/** Force a flush now (app background, sign-out). Best-effort; the kv copy stays warm
 *  so an un-pushed mark re-flushes on the next hydrate/read. */
export async function flushReadsNow(): Promise<void> {
  await flush();
}

/** Record that `roomId` was read at `ts` (typically `Date.now()` on room open). Applies
 *  an optimistic max into the local cache immediately (notify React + warm kv), then
 *  arms the debounced flush so a burst of opens coalesces into one synced push. */
export function setRoomReadAt(session: Session, roomId: string, ts: number): void {
  activeKey = keyFor(session.userId);
  flushSession = session;
  if (ts > (cache.rooms[roomId] ?? 0)) {
    emit({ rooms: { ...cache.rooms, [roomId]: ts } });
    persist();
  }
  // Arm-once trailing debounce: flush at most every FLUSH_DELAY_MS from the first
  // pending write, so continuous channel-switching can't starve the flush.
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}
