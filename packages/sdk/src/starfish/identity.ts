/**
 * Identity bootstrap — thin wrappers that keep the old 2-arg call ergonomics
 * (`buildSession({userId,keys}, name?)`, `deriveSession(seedWords, name?)`,
 * `buildLinkedSession(linked, name?)`) while injecting the per-call `clientOpts`
 * required by starfish-spaces 0.25+.
 *
 * `sessionFromPersisted` / `activeAccountOf` / `rootIdentityOf` are re-exported from
 * octospaces-sdk at `index.ts:58` — in 0.25.0 they are thin wrappers that delegate to
 * starfish-spaces and return the NEW Session shape (with `layout`, `contentCap`, etc.).
 * No additional shimming is needed here.
 */
import {
  buildSession as _buildSession,
  buildLinkedSession as _buildLinkedSession,
  deriveSession as _deriveSession,
  ownerTrustedAdders,
  generateSeedWords,
  isValidSeed,
  fingerprintFromUserId,
} from '@drakkar.software/starfish-spaces';
import type { Session, LinkedIdentity, DeviceKeys, BuildLinkedSessionOpts } from '@drakkar.software/starfish-spaces';
import { getSyncBase, getSyncNamespace, getSharedSpacesNamespace } from '@drakkar.software/octospaces-sdk';
import { pullCache, PULL_CACHE_MAX_AGE_MS, CACHE_FALLBACK_STATUSES } from './pull-cache';
import { getOnServerReachable } from '../config/config';

export type { Session, LinkedIdentity };
export { ownerTrustedAdders, generateSeedWords, isValidSeed, fingerprintFromUserId };

/** Current global connection opts, injected into each session builder. */
function clientOpts() {
  return {
    baseUrl: getSyncBase(),
    namespace: getSyncNamespace() ?? '',
    cache: pullCache(),
    cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
    cacheFallbackStatuses: [...CACHE_FALLBACK_STATUSES],
    onRevalidated: () => getOnServerReachable()?.(),
  };
}

/** Optional shared-namespace for multi-namespace setups. */
function sharedNs(): string | undefined {
  const ns = getSharedSpacesNamespace();
  return ns ?? undefined;
}

/** Derive a session from a BIP-39 seed phrase. Preserves old `(seedWords, name?)` signature. */
export async function deriveSession(seedWords: string[], name?: string): Promise<Session> {
  return _deriveSession(seedWords, clientOpts(), { name, sharedNamespace: sharedNs() });
}

/** Build a session from a pre-derived root identity. Preserves old `({userId,keys}, name?)` signature. */
export async function buildSession(
  opts: { userId: string; keys: DeviceKeys },
  name?: string,
): Promise<Session> {
  return _buildSession({ ...opts, name, clientOpts: clientOpts(), sharedNamespace: sharedNs() });
}

/** Build a session from a QR-paired linked identity. Preserves old `(linked, name?)` signature. */
export async function buildLinkedSession(linked: LinkedIdentity, name?: string): Promise<Session> {
  return _buildLinkedSession({
    identity: linked,
    name,
    clientOpts: clientOpts(),
    sharedNamespace: sharedNs(),
  } as BuildLinkedSessionOpts);
}
