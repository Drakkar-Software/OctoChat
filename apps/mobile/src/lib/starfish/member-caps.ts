/**
 * Member caps for spaces this identity has JOINED (vs. owns). Maps spaceId →
 * space member cap-cert JSON so `useRoom` can open a joined space's channels as
 * a keyring recipient (one cap covers every channel in the space).
 *
 * TWO tiers: the durable source of truth is the user's own synced `_spaces` doc
 * (see `registry.ts` — `caps` key), which a fresh device re-hydrates from its seed;
 * the platform kv (web localStorage / native AsyncStorage) is a fast, offline cache.
 * Both are keyed PER-USER so accounts never see each other's memberships. On
 * sign-in / account switch we hydrate the server doc OVER the local cache into an
 * in-memory map so reads stay synchronous for the hooks that consume them during
 * render (`useRoom`).
 */
import type { CapMap } from '@/lib/types';

import { kvGet, kvRemove, kvSet } from './kv';

/** Pre-multi-account global blob; adopted once by the first user that hydrates. */
const LEGACY_KEY = 'octochat.membercaps.v1';
const keyFor = (userId: string) => `octochat.membercaps.${userId}`;

let cache: CapMap = {};
let activeKey: string | null = null;

/**
 * Load the active account's joined-space caps into memory. Call (and await) on
 * sign-in and on every account switch, before opening rooms. Re-hydrating for the
 * same user is a no-op.
 *
 * Two-tier load: the local kv first (fast, offline), then the caps from the user's
 * own synced `_spaces` doc merged OVER it (the durable source of truth). The caller
 * (session-context) reads that doc once and passes its `caps` in — so this module
 * stays pure cap-storage and the doc isn't pulled twice at startup. Merging
 * server-over-local is what makes a fresh device — empty kv, same seed — recover its
 * caps and a re-issued cap take precedence. Empty `serverCaps` (e.g. an unreachable
 * read, which degrades to `{}` upstream) leaves the local-only cache intact, so the
 * common online-device case is unaffected.
 */
export async function hydrateMemberCaps(userId: string, serverCaps: CapMap): Promise<void> {
  const key = keyFor(userId);
  if (activeKey === key) return;
  activeKey = key;
  cache = {};
  // 1. Local kv — fast path, available offline.
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
    } catch (e) {
      // Don't fail silently: a corrupt blob drops every joined-space cap. The durable
      // `_spaces` doc re-heals them below (step 2), but surface it so it's diagnosable.
      console.error('[OctoChat] member-caps: corrupt cache blob, resetting:', e);
      cache = {};
    }
  }
  // 2. Server caps win — recover caps a fresh device's kv never had.
  if (Object.keys(serverCaps).length > 0) {
    cache = { ...cache, ...serverCaps };
    await kvSet(key, JSON.stringify(cache)); // warm kv for the next offline open
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
 *  the next {@link hydrateMemberCaps} reloads the new (or re-added) user's set. Must
 *  be paired with `clearSpaceEncryptors()` (see space-encryptor.ts) — both are wired
 *  into session-context.resetAccountScopedState — so a cached owner-branch encryptor
 *  can't outlive the cap context it was opened under. */
export function clearMemberCaps(): void {
  cache = {};
  activeKey = null;
}
