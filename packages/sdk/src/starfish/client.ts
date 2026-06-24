/**
 * Starfish client construction + room keyring/encryptor helpers.
 *
 * Profile read/write functions are thin wrappers that inject the global
 * connection config (baseUrl, namespace via the octospaces-sdk residual
 * `getSyncBase()` / `getSyncNamespace()`) into the new starfish-spaces API,
 * preserving the old single-argument call signature used throughout the app.
 *
 * openEncryptor / buildEncryptor are OctoChat-flavored wrappers: they take a
 * `spaceId` string and construct the keyring pull path internally.
 *
 * makeClient is re-exported as an alias for the renamed makeSpaceClient.
 */
import type { Encryptor } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import {
  makeSpaceClient,
  capProviderFor,
  openEncryptor as _openEncryptor,
  buildEncryptor as _buildEncryptor,
  ownerEnsureKeyring,
  readProfile as _readProfile,
  readProfiles as _readProfiles,
  writeProfile as _writeProfile,
  ensurePseudo as _ensurePseudo,
  ensureProfileKeys as _ensureProfileKeys,
  defaultSpaceLayout,
} from '@drakkar.software/starfish-spaces';
import type { DeviceKeys, PublicProfile, SpaceLayout } from '@drakkar.software/starfish-spaces';
import { signRequest, stableStringify } from '@drakkar.software/starfish-protocol';
import type { SignableMethod } from '@drakkar.software/starfish-protocol';
import {
  getSyncBase,
  getSyncNamespace,
  profilePull,
  profilePush,
  accountScope,
  linkedDeviceScope,
} from '@drakkar.software/octospaces-sdk';

import { keyringPull } from './paths';
import { pullCache, PULL_CACHE_MAX_AGE_MS, CACHE_FALLBACK_STATUSES } from './pull-cache';

export type { DeviceKeys, PublicProfile };
export { capProviderFor, ownerEnsureKeyring };

/**
 * Build cap-cert auth headers for a raw `fetch` outside the StarfishClient (e.g. `GET /events`).
 * Signing host is derived from `getSyncBase()` so the server-side verifier agrees — same pin as
 * the client's own REST requests (StarfishClient.signingHost).
 *
 * starfish-spaces re-exports its own `buildAuthHeaders` that hardcodes `host: ""`, which causes
 * `verifyRequestSignature` to fail on deployed servers that bind host (events.ts:116,126). This
 * local override restores the pre-`8f84d34` behavior: sign the REAL host.
 */
export async function buildAuthHeaders(
  cap: unknown,
  devEdPrivHex: string,
  method: string,
  pathAndQuery: string,
): Promise<Record<string, string>> {
  let host = '';
  try {
    host = new URL(getSyncBase()).host;
  } catch { /* relative base — empty host, both sides agree */ }

  const { sig, ts, nonce } = await signRequest(
    { method: method as SignableMethod, pathAndQuery, host },
    devEdPrivHex,
  );

  const capJson = stableStringify(cap as Record<string, unknown>);
  const capB64 =
    typeof btoa === 'function'
      ? btoa(capJson)
      : Buffer.from(capJson, 'utf-8').toString('base64');

  return {
    Authorization: `Cap ${capB64}`,
    'X-Starfish-Sig': sig,
    'X-Starfish-Ts': String(ts),
    'X-Starfish-Nonce': nonce,
  };
}

/** makeClient wrapper — renamed to makeSpaceClient in starfish-spaces; injects connection globals so
 *  callers keep the old 2-arg ergonomics: makeClient(cap, edPrivHex). */
export function makeClient(cap: unknown, devEdPrivHex: string): StarfishClient {
  return makeSpaceClient(cap, devEdPrivHex, {
    baseUrl: getSyncBase(),
    namespace: getSyncNamespace() ?? '',
    cache: pullCache(),
    cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
    cacheFallbackStatuses: [...CACHE_FALLBACK_STATUSES],
  });
}

/**
 * Build the OctoChat SpaceLayout:
 *  - namespace-aware profile paths (octospaces-sdk `profilePull`/`profilePush`)
 *  - explicit-collection `accountScope`/`linkedDeviceScope` so the minted account
 *    cap carries `collections: ["profile","devices","spaces","spaceregistry","inbox"]`
 *    instead of `["*"]`. The Starfish server synthesises cap roles by literal concat
 *    (`cap:read:<col>`); a wildcard `["*"]` produces `cap:read:*` which never matches
 *    the `spaces` collection's required `cap:read:spaces` — causing a 403 on `_spaces`.
 *
 * This layout is installed module-wide via `configureSpaces({ layout: octoLayout() })`
 * inside `configureOctoChat` so every session builder (fresh + restore) picks it up.
 */
export function octoLayout(): SpaceLayout {
  return { ...defaultSpaceLayout, profilePull, profilePush, accountScope, linkedDeviceScope };
}

/** Read a user's public profile (pseudo, avatar, public keys). Injects globals. */
export async function readProfile(userId: string): Promise<PublicProfile> {
  return _readProfile(userId, { baseUrl: getSyncBase(), layout: octoLayout() });
}

/** Read just the pseudo of a user (convenience for notification formatting). */
export async function readPseudo(userId: string): Promise<string | null> {
  return readProfile(userId).then((p) => p.pseudo ?? null).catch(() => null);
}

/** Read multiple users' profiles in batched round-trips. Injects globals. */
export async function readProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  return _readProfiles(ids, {
    baseUrl: getSyncBase(),
    namespace: getSyncNamespace() ?? '',
    layout: octoLayout(),
  });
}

/** Merge a patch into the caller's own profile doc. Injects the layout. */
export async function writeProfile(
  client: StarfishClient,
  userId: string,
  patch: { pseudo?: string; avatar?: string | null; edPub?: string; kemPub?: string; kemSig?: string },
): Promise<void> {
  return _writeProfile(client, userId, octoLayout(), patch);
}

/** Seed the caller's profile pseudo only when none exists yet. Injects the layout. */
export async function ensurePseudo(
  client: StarfishClient,
  userId: string,
  fallback: string,
): Promise<string> {
  return _ensurePseudo(client, userId, octoLayout(), fallback);
}

/** Publish this identity's Ed + KEM keys in its profile (one-time, idempotent). Injects the layout. */
export async function ensureProfileKeys(
  client: StarfishClient,
  userId: string,
  keys: { edPub: string; kemPub: string; edPriv: string },
): Promise<void> {
  return _ensureProfileKeys(client, userId, octoLayout(), keys);
}

/**
 * Open a space's decryptor by spaceId, throwing a descriptive error per failure mode.
 * Wraps starfish-spaces' path-based openEncryptor using keyringPull(spaceId).
 */
export async function openEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[],
): Promise<Encryptor> {
  return _openEncryptor(client, keys, keyringPull(spaceId), trustedAdders);
}

/** Soft variant of {@link openEncryptor}: returns null instead of throwing. */
export async function buildEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[],
): Promise<Encryptor | null> {
  return _buildEncryptor(client, keys, keyringPull(spaceId), trustedAdders);
}
