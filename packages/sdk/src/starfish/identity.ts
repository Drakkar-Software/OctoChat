/**
 * Identity bootstrap — thin wrappers that keep the old 2-arg call ergonomics
 * (`buildSession({userId,keys}, name?)`, `deriveSession(seedWords, name?)`,
 * `buildLinkedSession(linked, name?)`, `sessionFromPersisted(persisted)`) while
 * injecting the per-call `clientOpts` required by starfish-spaces.
 *
 * dk-spaces-sdk 0.31 dropped its `sessionFromPersisted` proxy — clients now call
 * starfish-spaces directly and must pass `clientOpts` themselves (2nd positional
 * arg). `activeAccountOf` / `rootIdentityOf` take no `clientOpts` and are
 * re-exported unchanged.
 */
import {
  buildSession as _buildSession,
  buildLinkedSession as _buildLinkedSession,
  deriveSession as _deriveSession,
  sessionFromPersisted as _sessionFromPersisted,
  activeAccountOf,
  rootIdentityOf,
  ownerTrustedAdders,
  generateSeedWords,
  isValidSeed,
  fingerprintFromUserId,
} from '@drakkar.software/starfish-spaces';
import type {
  Session,
  LinkedIdentity,
  DeviceKeys,
  BuildLinkedSessionOpts,
  PersistedSession,
} from '@drakkar.software/starfish-spaces';
import { getSyncBase, getSyncNamespace, getSharedSpacesNamespace } from '@drakkar.software/dk-spaces-sdk';
import { pullCache, PULL_CACHE_MAX_AGE_MS, CACHE_FALLBACK_STATUSES } from './pull-cache';
import { getOnServerReachable } from '../config/config';

export type { Session, LinkedIdentity, PersistedSession };
export { ownerTrustedAdders, generateSeedWords, isValidSeed, fingerprintFromUserId, activeAccountOf, rootIdentityOf };

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

/** Restore a session from a persisted account. Preserves old `(persisted)` signature. */
export async function sessionFromPersisted(persisted: PersistedSession): Promise<Session> {
  return _sessionFromPersisted(persisted, clientOpts(), { sharedNamespace: sharedNs() });
}
