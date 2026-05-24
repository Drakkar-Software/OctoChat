/**
 * Persisted session (web). The recovery seed is the master secret, so it is
 * NEVER stored in cleartext: localStorage holds only an AEAD envelope, and the
 * key that opens it is derived from a secret that is not on disk — a user PIN
 * (always) and, optionally, a WebAuthn passkey's PRF secret. A disk/localStorage
 * scraper therefore recovers only ciphertext.
 *
 * Two seal flavours, because the two secrets have very different entropy:
 *  - PIN — ~20 bits, so it is Argon2id-stretched (`sealWithPassphrase`, the same
 *    primitive the device-pairing flow uses) to make offline brute-force costly.
 *  - Passkey PRF secret — 256 bits, uniformly random. Stretching it buys nothing
 *    (256 bits is unbruteforceable regardless of KDF), so it keys AES-GCM directly.
 *    This is what makes passkey unlock near-instant vs. the PIN's heavy Argon2id.
 *
 * The sealed payload caches the derived root identity (see `PersistedSession`),
 * so unlock skips the second heavy Argon2id (`bootstrapRootIdentity`) entirely.
 *
 * The native variant (storage.native.ts) keeps using expo-secure-store, where
 * the OS already encrypts at rest — no PIN/passkey there.
 */
import { openWithPassphrase, sealWithPassphrase } from '@drakkar.software/starfish-identities';

import { evalPasskey, passkeySupported as webauthnSupported } from './passkey';
import { bytesToHex } from './paths';
import type { LoadResult, PersistedSession, SeedLock, UnlockMethod } from './storage-types';

export type { PersistedSession } from './storage-types';

const KEY = 'octochat.session.v1';
const IV_BYTES = 12;

/** A `sealWithPassphrase` output blob (opaque, JSON-serializable). */
type Sealed = Record<string, unknown>;

/** Passkey copy: AES-GCM under the PRF secret (no Argon2id). Values are hex. */
interface PasskeyBlock {
  credentialId: string;
  salt: string;
  kind: 'aes-gcm';
  iv: string;
  ct: string;
}

/** Versioned localStorage envelope. `pin` is always present; `passkey` optional. */
interface Envelope {
  v: 3;
  pin: Sealed;
  passkey?: PasskeyBlock;
}

function ls(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

// ArrayBuffer-backed views: Web Crypto's `BufferSource` rejects the default
// `Uint8Array<ArrayBufferLike>` (which may be a SharedArrayBuffer).
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** AES-GCM seal with a raw high-entropy key (hex). Output values are hex. */
async function aesGcmSeal(keyHex: string, plaintext: Uint8Array<ArrayBuffer>): Promise<{ iv: string; ct: string }> {
  const key = await globalThis.crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(IV_BYTES);
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: bytesToHex(iv), ct: bytesToHex(new Uint8Array(ct)) };
}

/** Inverse of {@link aesGcmSeal}. Throws on wrong key / tampered ciphertext. */
async function aesGcmOpen(keyHex: string, blob: { iv: string; ct: string }): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(blob.iv) },
    key,
    hexToBytes(blob.ct),
  );
  return new Uint8Array(pt);
}

function readEnvelope(): Envelope | null {
  let raw: string | null | undefined;
  try {
    raw = ls()?.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<Envelope>;
    if (obj?.v === 3 && obj.pin) return obj as Envelope;
  } catch {
    /* fall through to cleanup */
  }
  // Unrecognized value at our key — a legacy plaintext seed or an older envelope
  // version. There's no backward-compat unlock, but we must NOT leave a stale
  // secret on disk: drop it so the "seed is never persisted in cleartext"
  // guarantee holds for users upgrading. They re-onboard with the seed words.
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return null;
}

function seedToBytes(s: PersistedSession): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(s)) as Uint8Array<ArrayBuffer>;
}

function bytesToSeed(bytes: Uint8Array): PersistedSession {
  return JSON.parse(new TextDecoder().decode(bytes)) as PersistedSession;
}

export async function loadStoredSession(): Promise<LoadResult> {
  const env = readEnvelope();
  if (!env) return { kind: 'none' };
  const methods: UnlockMethod[] = ['pin'];
  // Offer passkey only if one is enrolled AND this browser can still run WebAuthn.
  if (env.passkey && webauthnSupported()) methods.push('passkey');
  return { kind: 'locked', methods };
}

export async function saveSession(s: PersistedSession, lock?: SeedLock): Promise<void> {
  if (!lock?.pin) throw new Error('A PIN is required to secure your account on the web.');
  const bytes = seedToBytes(s);
  const env: Envelope = { v: 3, pin: (await sealWithPassphrase(lock.pin, bytes)) as unknown as Sealed };
  // The passkey was already enrolled by the UI (WebAuthn needs a fresh gesture,
  // so it runs before this seal); here we just AES-GCM a copy under its PRF secret.
  if (lock.passkey) {
    const { credentialId, salt, secretHex } = lock.passkey;
    const { iv, ct } = await aesGcmSeal(secretHex, bytes);
    env.passkey = { credentialId, salt, kind: 'aes-gcm', iv, ct };
  }
  ls()?.setItem(KEY, JSON.stringify(env));
}

export async function unlockSession(method: UnlockMethod, pin?: string): Promise<PersistedSession> {
  const env = readEnvelope();
  if (!env) throw new Error('No saved account to unlock.');

  if (method === 'passkey') {
    if (!env.passkey) throw new Error('No passkey is enrolled.');
    const secretHex = await evalPasskey(env.passkey.credentialId, env.passkey.salt);
    return bytesToSeed(await aesGcmOpen(secretHex, env.passkey));
  }

  if (!pin) throw new Error('Enter your PIN.');
  try {
    return bytesToSeed(await openWithPassphrase(pin, env.pin as never));
  } catch {
    throw new Error('Wrong PIN.');
  }
}

export function passkeySupported(): boolean {
  return webauthnSupported();
}

export async function clearStoredSession(): Promise<void> {
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
