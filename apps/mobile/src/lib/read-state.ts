/**
 * Per-room "last read" marks — the highest message timestamp the viewer has
 * seen in a room. Unread = messages newer than this, authored by someone else.
 *
 * Stored as one map under a single platform-kv key (web localStorage / native
 * AsyncStorage) and hydrated into an in-memory cache once at startup, so reads
 * stay synchronous for the unread provider's render-time computation. Mirrors
 * the cache pattern in `starfish/member-caps.ts`. Per-device only — multi-device
 * read-state sync is deferred.
 */
import { kvGet, kvSet } from './starfish/kv';

type ReadMap = Record<string, number>;

const KEY = 'octochat.lastread.v1';

let cache: ReadMap = {};
let hydrated = false;

/** Load persisted last-read marks into memory. Await once before computing unread. */
export async function hydrateReadState(): Promise<void> {
  if (hydrated) return;
  const raw = await kvGet(KEY);
  if (raw) {
    try {
      cache = JSON.parse(raw) as ReadMap;
    } catch {
      cache = {};
    }
  }
  hydrated = true;
}

/** Highest message ts the viewer has read in this room (0 if never). */
export function getLastRead(roomId: string): number {
  return cache[roomId] ?? 0;
}

/** Advance a room's last-read mark (never moves backwards) and persist. */
export function setLastRead(roomId: string, ts: number): void {
  if ((cache[roomId] ?? 0) >= ts) return;
  cache = { ...cache, [roomId]: ts };
  void kvSet(KEY, JSON.stringify(cache));
}

/** Forget all read marks (on lock / identity switch). */
export function clearReadState(): void {
  cache = {};
  void kvSet(KEY, JSON.stringify(cache));
}
