/**
 * Member caps for rooms this identity has JOINED (vs. owns). Maps roomId →
 * member cap-cert JSON so `useRoom` can open someone else's room as a recipient.
 *
 * Persisted via the platform kv (web localStorage / native AsyncStorage) and
 * hydrated into an in-memory cache once at startup, so reads stay synchronous
 * for the hooks that consume them during render.
 */
import { kvGet, kvSet } from './kv';

type CapMap = Record<string, string>;

const KEY = 'octochat.membercaps.v1';

let cache: CapMap = {};
let hydrated = false;

/** Load persisted caps into memory. Call (and await) once before opening rooms. */
export async function hydrateMemberCaps(): Promise<void> {
  if (hydrated) return;
  const raw = await kvGet(KEY);
  if (raw) {
    try {
      cache = JSON.parse(raw) as CapMap;
    } catch {
      cache = {};
    }
  }
  hydrated = true;
}

export function getMemberCap(roomId: string): string | null {
  return cache[roomId] ?? null;
}

export function saveMemberCap(roomId: string, capJson: string): void {
  cache = { ...cache, [roomId]: capJson };
  void kvSet(KEY, JSON.stringify(cache));
}

/** Forget all joined-room caps (on lock / identity switch). */
export function clearMemberCaps(): void {
  cache = {};
  void kvSet(KEY, JSON.stringify(cache));
}
