/**
 * Member caps for spaces this identity has JOINED (vs. owns). Maps spaceId →
 * space member cap-cert JSON so `useRoom` can open a joined space's channels as
 * a keyring recipient (one cap covers every channel in the space).
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

export function getMemberCap(spaceId: string): string | null {
  return cache[spaceId] ?? null;
}

export function saveMemberCap(spaceId: string, capJson: string): void {
  cache = { ...cache, [spaceId]: capJson };
  void kvSet(KEY, JSON.stringify(cache));
}

/** Forget one joined space's cap (on leaving that space). */
export function removeMemberCap(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  void kvSet(KEY, JSON.stringify(cache));
}

/** Forget all joined-space caps (on lock / identity switch). */
export function clearMemberCaps(): void {
  cache = {};
  void kvSet(KEY, JSON.stringify(cache));
}
