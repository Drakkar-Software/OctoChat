/**
 * Identity bootstrap — thin wrappers that keep the old 2-arg call ergonomics
 * (`buildSession({userId,keys}, name?)`, `deriveSession(seedWords, name?)`,
 * `buildLinkedSession(linked, name?)`) while injecting the per-call `clientOpts`
 * required by starfish-spaces 0.25+.  The `sessionFromPersisted` / `activeAccountOf`
 * wrappers in octospaces-sdk (0.25 still exports them) use the same pattern.
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

export type { Session, LinkedIdentity };
export { ownerTrustedAdders, generateSeedWords, isValidSeed, fingerprintFromUserId };
// rootIdentityOf is re-exported from octospaces-sdk in index.ts (wraps starfish-spaces with globals).

/** Current global connection opts, injected into each session builder. */
function clientOpts() {
  return { baseUrl: getSyncBase(), namespace: getSyncNamespace() ?? '' };
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
