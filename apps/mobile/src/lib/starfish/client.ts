/**
 * Starfish client construction + room keyring/encryptor helpers
 * (ported from the satellite chat example, adapted to OctoChat).
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishCapProvider } from '@drakkar.software/starfish-client';
import { createKeyring, createKeyringEncryptor } from '@drakkar.software/starfish-keyring';
import type { Keyring } from '@drakkar.software/starfish-keyring';
import { signRequest, stableStringify } from '@drakkar.software/starfish-protocol';
import type { SignableMethod } from '@drakkar.software/starfish-protocol';

import { SYNC_BASE, SYNC_PREFIX } from './config';
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
  return new StarfishClient({ baseUrl: SYNC_BASE, capProvider: capProviderFor(cap, devEdPrivHex) });
}

/**
 * Wrap a client so SDK helpers that build their OWN `/pull/…` `/push/…` action
 * paths (e.g. starfish-keyring's `addCollectionRecipient`) get `SYNC_PREFIX`
 * applied. Those helpers are namespace-unaware: on the deployed `/v1/octochat`
 * server an unprefixed `/sync/pull/…` misses every nginx location and hits the
 * catch-all → 404 with no CORS headers, which the browser surfaces as
 * "Failed to fetch". Our own `paths.ts` helpers already include the prefix, so
 * this is ONLY for SDK-built paths. The prefix lands in the signed path too
 * (the SDK signs the path we hand it), which the server requires. No-op when
 * `SYNC_PREFIX` is empty (local dev) — which is why this only bites the deploy.
 */
export function prefixedClient(client: StarfishClient): StarfishClient {
  if (!SYNC_PREFIX) return client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'pull' || prop === 'push') {
        const orig = Reflect.get(target, prop, target) as (path: string, ...rest: unknown[]) => unknown;
        return (path: string, ...rest: unknown[]) => orig.call(target, `${SYNC_PREFIX}${path}`, ...rest);
      }
      return Reflect.get(target, prop, receiver);
    },
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

/** Owner-side: create the SPACE keyring if missing, return an encryptor. */
export async function ownerEnsureKeyring(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
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
    { trustedAdders: [keys.edPub] },
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

/** A user's public profile: display pseudo + optional inline avatar (data URI). */
export interface PublicProfile {
  pseudo: string | null;
  avatar: string | null;
}

/** Read any user's public profile — pseudo and the inlined avatar data URI. */
export async function readProfile(userId: string): Promise<PublicProfile> {
  // The concurrent callers this used to dedupe are now resolved by one owner each:
  // self by ProfileProvider (which primes the shared cache), and other users by the
  // `use-pseudos` cache (which fetches a given id at most once).
  try {
    const r = await fetch(`${SYNC_BASE}${profilePull(userId)}`);
    if (!r.ok) return { pseudo: null, avatar: null };
    const body = await r.json();
    const data = body?.data as { pseudo?: unknown; avatar?: unknown } | undefined;
    return {
      pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null,
      avatar: typeof data?.avatar === 'string' ? data.avatar : null,
    };
  } catch {
    return { pseudo: null, avatar: null };
  }
}

/** Read any user's public profile pseudo. */
export async function readPseudo(userId: string): Promise<string | null> {
  return (await readProfile(userId)).pseudo;
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
  patch: { pseudo?: string; avatar?: string | null },
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
 * Seed the caller's profile pseudo only if none exists yet, returning the
 * authoritative server value. Used on every session derivation so reopening an
 * identity — here or on another device — adopts the stored pseudo instead of
 * clobbering an edit back to the bootstrap default.
 */
export async function ensurePseudo(client: StarfishClient, userId: string, fallback: string): Promise<string> {
  const existing = (await readProfile(userId)).pseudo;
  if (existing && existing.trim()) return existing;
  await writeProfile(client, userId, { pseudo: fallback });
  return fallback;
}
