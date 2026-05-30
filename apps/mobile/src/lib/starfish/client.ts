/**
 * Starfish client construction + room keyring/encryptor helpers
 * (ported from the satellite chat example, adapted to OctoChat).
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import type { BatchPullEntry, Encryptor, StarfishCapProvider } from '@drakkar.software/starfish-client';
import { createKeyring, createKeyringEncryptor } from '@drakkar.software/starfish-keyring';
import type { Keyring } from '@drakkar.software/starfish-keyring';
import { signRequest, stableStringify } from '@drakkar.software/starfish-protocol';
import type { SignableMethod } from '@drakkar.software/starfish-protocol';

import { SYNC_BASE, SYNC_NAMESPACE, SYNC_PREFIX } from './config';
import { fetchWithTimeout } from './fetch-timeout';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from './pull-cache';
import { cacheProfile, loadCachedProfile } from './profile-cache';
import { keyringPull, keyringPush, profilePull, profilePush, roomPull, roomPush } from './paths';

export interface DeviceKeys {
  edPriv: string;
  edPub: string;
  kemPriv: string;
  kemPub: string;
}

export function capProviderFor(cap: unknown, devEdPrivHex: string): StarfishCapProvider {
  return {
    async getCap() {
      return { cap: cap as never, devEdPrivHex };
    },
  };
}

export function makeClient(cap: unknown, devEdPrivHex: string): StarfishClient {
  // `namespace` makes the client prepend `/v1/<namespace>` to every request path —
  // both the URL and the signed canonical path, AND the paths SDK helpers build
  // internally (keyring `addCollectionRecipient`, blobs). That's why no path-prefix
  // wrapper is needed anymore. Undefined locally (root-mounted), so paths pass through.
  return new StarfishClient({
    baseUrl: SYNC_BASE,
    namespace: SYNC_NAMESPACE,
    capProvider: capProviderFor(cap, devEdPrivHex),
    // Bound the connect phase so a stalled socket rejects instead of hanging the
    // room-open path forever (Android network transitions) — see fetch-timeout.ts.
    fetch: fetchWithTimeout(),
    // Offline-first: read-through cache so the space `_keyring`, room registries
    // and any structured pull survive offline (ciphertext-at-rest). See pull-cache.ts.
    cache: pullCache(),
    cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
  });
}

/**
 * Open a SPACE's decryptor, throwing a descriptive error per failure mode
 * (unreachable server / no keyring yet / not a recipient) instead of collapsing
 * them all to null. One keyring per space drives every channel in it.
 *
 * `trustedAdders` is the fail-closed provenance pin the SDK requires (the
 * keyring's per-entry `addedSig` is self-attesting, so a hostile server could
 * substitute a wrapped CEK). Pass the Ed25519 pubkey(s) of whoever may grant
 * keyring access: the space owner — `keys.edPub` for our own spaces, the member
 * cap's `iss` for a joined space.
 */
export async function openEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[],
): Promise<Encryptor> {
  // The room/thread `_keyring × 2` burst this used to dedupe is now collapsed one
  // level up by the per-space encryptor cache (space-encryptor.ts), which opens each
  // space keyring once and shares it across the room screen and its threads.
  const res = await client.pull(keyringPull(spaceId)).catch(() => {
    throw new Error('Could not reach the server to fetch space keys.');
  });
  const keyring = res?.data as unknown as Keyring | undefined;
  if (!keyring || !keyring.epochs) {
    throw new Error('This space has no keyring yet — ask the owner to open it first.');
  }
  try {
    const enc = await createKeyringEncryptor(
      keyring,
      { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv },
      { trustedAdders },
    );
    return enc as unknown as Encryptor;
  } catch {
    throw new Error("You're not a recipient of this space's keyring yet — ask the owner to re-invite.");
  }
}

/** Soft variant of {@link openEncryptor}: returns null instead of throwing. */
export async function buildEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[],
): Promise<Encryptor | null> {
  try {
    return await openEncryptor(client, keys, spaceId, trustedAdders);
  } catch {
    return null;
  }
}

/**
 * Owner-side: create the SPACE keyring if missing, return an encryptor.
 *
 * `trustedAdders` is the provenance allow-list for opening the keyring; it
 * defaults to the caller's own key but must be widened for a PAIRED device, whose
 * keyring entries were signed by the ROOT (not its device key) — see
 * `ownerTrustedAdders`. The CEK is still unwrapped with `keys` (this device's KEM
 * keypair, which the root added as a recipient).
 */
export async function ownerEnsureKeyring(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[] = [keys.edPub],
): Promise<Encryptor> {
  const krRes = await client.pull(keyringPull(spaceId)).catch(() => null);
  let keyring = krRes?.data as unknown as Keyring | undefined;
  if (!keyring || !keyring.epochs) {
    const created = await createKeyring({ edPrivHex: keys.edPriv, edPubHex: keys.edPub }, [
      { subKemHex: keys.kemPub },
    ]);
    keyring = created.keyring;
    await client.push(keyringPush(spaceId), keyring as unknown as Record<string, unknown>, krRes?.hash ?? null);
  }
  const enc = await createKeyringEncryptor(
    keyring,
    { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv },
    { trustedAdders },
  );
  return enc as unknown as Encryptor;
}

/** Owner-side: seed an empty encrypted room document if missing. The encryptor
 *  is the space encryptor — every channel in the space seals with it. */
export async function ensureRoomInitialized(
  client: StarfishClient,
  encryptor: Encryptor,
  roomId: string,
): Promise<void> {
  const res = await client.pull(roomPull(roomId)).catch(() => null);
  if (res?.data && (res.data as Record<string, unknown>)._encrypted) return;
  const sealed = await encryptor.encrypt({ messages: [], reactions: [] });
  await client.push(roomPush(roomId), sealed as Record<string, unknown>, res?.hash ?? null);
}

/** A user's public profile: display pseudo + optional inline avatar (data URI) +
 *  their PUBLIC identity keys. The keys are published so a peer can start an E2EE DM
 *  (seal a keyring to `kemPub`, bind a member cap to `edPub`); they are public by
 *  design, so this leaks nothing. Absent (`null`) for identities that predate key
 *  publishing — the DM "Message" affordance stays disabled until they're backfilled. */
export interface PublicProfile {
  pseudo: string | null;
  avatar: string | null;
  edPub: string | null;
  kemPub: string | null;
}

/** Read any user's public profile — pseudo and the inlined avatar data URI. */
export async function readProfile(userId: string): Promise<PublicProfile> {
  // The concurrent callers this used to dedupe are now resolved by one owner each:
  // self by ProfileProvider (which primes the shared cache), and other users by the
  // `use-pseudos` cache (which fetches a given id at most once).
  try {
    // Raw unauthenticated GET (public profile) — bypasses the StarfishClient, so the
    // `namespace` it would add is applied here via SYNC_PREFIX, same as EVENTS_URL.
    const r = await fetchWithTimeout()(`${SYNC_BASE}${SYNC_PREFIX}${profilePull(userId)}`);
    if (!r.ok) return { pseudo: null, avatar: null, edPub: null, kemPub: null };
    const body = await r.json();
    const data = body?.data as { pseudo?: unknown; avatar?: unknown; edPub?: unknown; kemPub?: unknown } | undefined;
    const profile: PublicProfile = {
      pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null,
      avatar: typeof data?.avatar === 'string' ? data.avatar : null,
      edPub: typeof data?.edPub === 'string' ? data.edPub : null,
      kemPub: typeof data?.kemPub === 'string' ? data.kemPub : null,
    };
    cacheProfile(userId, profile); // offline-first: remember the last-known pseudo/avatar/keys
    return profile;
  } catch {
    // Offline (fetch rejected) — fall back to the last-known profile so names/avatars
    // don't vanish offline. A real `!r.ok` answer above is NOT overridden by cache.
    return (await loadCachedProfile(userId)) ?? { pseudo: null, avatar: null, edPub: null, kemPub: null };
  }
}

/** Read any user's public profile pseudo. */
export async function readPseudo(userId: string): Promise<string | null> {
  return (await readProfile(userId)).pseudo;
}

// Anonymous client for the public-read `profile` collection — mirrors readProfile's
// raw unauthenticated fetch (no cap ⇒ no auth headers), but routed through
// StarfishClient so it gets namespacing AND batch fan-in via /batch/pull. Built once.
let profileBatchClient: StarfishClient | undefined;
function getProfileBatchClient(): StarfishClient {
  if (!profileBatchClient) {
    profileBatchClient = new StarfishClient({ baseUrl: SYNC_BASE, namespace: SYNC_NAMESPACE, fetch: fetchWithTimeout() });
  }
  return profileBatchClient;
}

// Cap each /batch/pull query well under nginx's ~8KB header limit: userIds are
// 64-hex-char SHA-256 ids, so 24 of them as `params` JSON stays a few KB.
const PROFILE_BATCH_CHUNK = 24;

/**
 * Read MANY users' public profiles in one /batch/pull round-trip per
 * {@link PROFILE_BATCH_CHUNK} ids — the fan-in that replaces one request per user.
 * Returns a map keyed by userId; an id ABSENT from the map means its read failed
 * (a per-entry error or a whole-chunk network failure), so the caller should keep
 * any value it already had rather than wiping it. A present-but-empty profile doc
 * maps to `{pseudo: null, avatar: null}` so the caller can cache it and stop
 * re-fetching. `profile` is public-read, so the anonymous client resolves any id.
 */
export async function readProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  const client = getProfileBatchClient();
  for (let i = 0; i < ids.length; i += PROFILE_BATCH_CHUNK) {
    const chunk = ids.slice(i, i + PROFILE_BATCH_CHUNK);
    let entries: BatchPullEntry[];
    try {
      // The `profile` collection's path is `user/{identity}/profile`; the server
      // keeps an explicitly supplied identity, so this resolves each user's doc.
      entries = await client.batchPullMany('profile', chunk.map((id) => ({ identity: id })));
    } catch {
      // Network/5xx for this chunk — offline-first: fill from the last-known cache so
      // pseudos/avatars survive offline (cold start, where the in-memory cache is empty).
      for (const id of chunk) {
        const cached = await loadCachedProfile(id);
        if (cached) out.set(id, cached);
      }
      continue;
    }
    chunk.forEach((id, j) => {
      const entry = entries[j];
      if (!entry || entry.error) return; // unresolved → omit from map (no wipe, may retry)
      const data = (entry.data ?? null) as { pseudo?: unknown; avatar?: unknown; edPub?: unknown; kemPub?: unknown } | null;
      const profile: PublicProfile = {
        pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null,
        avatar: typeof data?.avatar === 'string' ? data.avatar : null,
        edPub: typeof data?.edPub === 'string' ? data.edPub : null,
        kemPub: typeof data?.kemPub === 'string' ? data.kemPub : null,
      };
      cacheProfile(id, profile); // warm the offline cache for this user
      out.set(id, profile);
    });
  }
  return out;
}

/**
 * Merge a patch into the caller's own profile doc (needs a cap with write on
 * `profile`). Pulls the current doc first so writing one field never drops the
 * others — saving a pseudo keeps the avatar and vice versa. `avatar: null`
 * explicitly removes the avatar.
 */
export async function writeProfile(
  client: StarfishClient,
  userId: string,
  patch: { pseudo?: string; avatar?: string | null; edPub?: string; kemPub?: string },
): Promise<void> {
  const current = await client.pull(profilePull(userId)).catch(() => null);
  const base = (current?.data as Record<string, unknown> | undefined) ?? {};
  const next: Record<string, unknown> = { ...base, ...patch, v: 1 };
  if (next.avatar == null) delete next.avatar; // null/undefined ⇒ remove the key
  await client.push(profilePush(userId), next, current?.hash ?? null);
}

/** Write the caller's own profile pseudo, preserving any other profile fields. */
export async function writePseudo(client: StarfishClient, userId: string, pseudo: string): Promise<void> {
  await writeProfile(client, userId, { pseudo });
}

/**
 * Publish this identity's PUBLIC keys (edPub + kemPub) in its profile, so a peer who
 * opens this profile can discover them and start an E2EE DM (seal a keyring to
 * `kemPub`, bind a member cap to `edPub`). The keys are public by design — co-members
 * already see each other — so this leaks nothing.
 *
 * One-time + idempotent: writes ONLY when a CONFIRMED read shows the keys absent
 * (404 or present-but-keyless), never on a transient read failure (which would risk a
 * needless write / clobber). Mirrors {@link ensurePseudo}'s confirmed-absent guard.
 * ROOT-DEVICE ONLY — `profile` is `device:root`-write, so a paired device must not
 * call this (it would 403). Best-effort: callers ignore failures and retry next open.
 */
export async function ensureProfileKeys(
  client: StarfishClient,
  userId: string,
  keys: { edPub: string; kemPub: string },
): Promise<void> {
  let confirmedAbsent = false;
  try {
    // Raw confirmed read (bypasses the client namespace like readOwnPseudo), so a
    // transient/server error is distinguishable from "no keys yet".
    const r = await fetchWithTimeout()(`${SYNC_BASE}${SYNC_PREFIX}${profilePull(userId)}`);
    if (r.status === 404) confirmedAbsent = true; // no profile yet → keys absent
    else if (r.ok) {
      const body = await r.json();
      const data = body?.data as { edPub?: unknown; kemPub?: unknown } | undefined;
      confirmedAbsent = !(typeof data?.edPub === 'string' && typeof data?.kemPub === 'string');
    } else return; // transient/server error — don't write
  } catch {
    return; // network error — don't write (no blind clobber)
  }
  if (!confirmedAbsent) return;
  await writeProfile(client, userId, { edPub: keys.edPub, kemPub: keys.kemPub });
}

/**
 * Build cap-cert auth headers for a raw `fetch` outside the StarfishClient
 * (e.g. `GET /events`). Signing host is derived from `SYNC_BASE` so the
 * server-side verifier agrees — same pin as the client's own requests.
 *
 * Mirrors the private `buildAuthHeaders` inside `StarfishClient` without
 * touching the satellite SDK.
 */
export async function buildAuthHeaders(
  cap: unknown,
  devEdPrivHex: string,
  method: string,
  pathAndQuery: string,
): Promise<Record<string, string>> {
  let host = '';
  try {
    host = new URL(SYNC_BASE).host;
  } catch { /* relative base — empty host, both sides agree */ }

  // alpha.12: one wire suite (Ed25519), no `alg` discriminator on signatures
  // or in headers.
  const { sig, ts, nonce } = await signRequest(
    { method: method as SignableMethod, pathAndQuery, host },
    devEdPrivHex,
  );

  // encodeCapAuth: btoa(stableStringify(cap)) — mirrors StarfishClient's private helper.
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

/**
 * Read the caller's OWN pseudo for the seed decision in {@link ensurePseudo},
 * distinguishing a confirmed-empty profile (404 / present-but-no-pseudo → safe to
 * seed) from a transient read failure (network / 5xx → must NOT seed). `readProfile`
 * collapses both to null — fine for displaying someone else's name, but unsafe as a
 * write trigger, since seeding on a transient failure overwrites a real pseudo set
 * on another device.
 */
async function readOwnPseudo(userId: string): Promise<{ read: boolean; pseudo: string | null }> {
  try {
    // SYNC_PREFIX: raw fetch bypasses the client's namespace, like readProfile above.
    const r = await fetchWithTimeout()(`${SYNC_BASE}${SYNC_PREFIX}${profilePull(userId)}`);
    if (r.status === 404) return { read: true, pseudo: null }; // confirmed: no profile yet
    if (!r.ok) return { read: false, pseudo: null }; // transient/server error — don't seed
    const body = await r.json();
    const data = body?.data as { pseudo?: unknown } | undefined;
    return { read: true, pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null };
  } catch {
    return { read: false, pseudo: null }; // network error — don't seed
  }
}

/**
 * Seed the caller's profile pseudo only if none exists yet, returning the
 * authoritative server value. Used on every session derivation so reopening an
 * identity — here or on another device — adopts the stored pseudo instead of
 * clobbering an edit back to the bootstrap default. A transient read failure returns
 * `fallback` for DISPLAY only and writes nothing — never overwrite on a blip.
 */
export async function ensurePseudo(client: StarfishClient, userId: string, fallback: string): Promise<string> {
  const { read, pseudo } = await readOwnPseudo(userId);
  if (pseudo && pseudo.trim()) return pseudo;
  if (!read) return fallback; // read failed — show fallback but DON'T persist (no clobber)
  await writeProfile(client, userId, { pseudo: fallback });
  return fallback;
}
