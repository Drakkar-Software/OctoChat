/**
 * Member caps for spaces this identity has JOINED (vs. owns). Maps spaceId →
 * space member cap-cert JSON so `useRoom` can open a joined space's channels as
 * a keyring recipient (one cap covers every channel in the space).
 *
 * Persisted via the platform kv (web localStorage / native AsyncStorage), keyed
 * PER-USER so accounts never see each other's memberships, and hydrated into an
 * in-memory cache on sign-in / account switch so reads stay synchronous for the
 * hooks that consume them during render.
 */
import { kvGet, kvRemove, kvSet } from './kv';

type CapMap = Record<string, string>;

/** Pre-multi-account global blob; adopted once by the first user that hydrates. */
const LEGACY_KEY = 'octochat.membercaps.v1';
const keyFor = (userId: string) => `octochat.membercaps.${userId}`;

let cache: CapMap = {};
let activeKey: string | null = null;

/**
 * Load the active account's joined-space caps into memory. Call (and await) on
 * sign-in and on every account switch, before opening rooms. Re-hydrating for the
 * same user is a no-op. Member cap-certs are owner-issued and not re-derivable, so
 * they are kept per-user on disk and survive switching away and back.
 */
export async function hydrateMemberCaps(userId: string): Promise<void> {
  const key = keyFor(userId);
  if (activeKey === key) return;
  activeKey = key;
  cache = {};
  let raw = await kvGet(key);
  if (raw === null) {
    // One-time adoption: the single pre-migration account owns the legacy blob.
    // Retire the global key afterwards so a second account can't inherit it.
    const legacy = await kvGet(LEGACY_KEY);
    if (legacy !== null) {
      raw = legacy;
      await kvSet(key, legacy);
      await kvRemove(LEGACY_KEY);
    }
  }
  if (raw) {
    try {
      cache = JSON.parse(raw) as CapMap;
    } catch {
      cache = {};
    }
  }
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

export function getMemberCap(spaceId: string): string | null {
  return cache[spaceId] ?? null;
}

export function saveMemberCap(spaceId: string, capJson: string): void {
  cache = { ...cache, [spaceId]: capJson };
  persist();
}

/** Forget one joined space's cap (on leaving that space). */
export function removeMemberCap(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  persist();
}

/** Drop the in-memory caps (on account switch / sign-out); leaves disk untouched so
 *  the next {@link hydrateMemberCaps} reloads the new (or re-added) user's set. */
export function clearMemberCaps(): void {
  cache = {};
  activeKey = null;
}
