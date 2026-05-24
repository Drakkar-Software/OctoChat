/**
 * Persisted session (web). The recovery seed is the master secret, so it is
 * NEVER stored in cleartext: localStorage holds only an AEAD envelope, and the
 * key that opens it is derived from a secret that is not on disk — a user PIN
 * (always) and, optionally, a WebAuthn passkey's PRF secret. A disk/localStorage
 * scraper therefore recovers only ciphertext.
 *
 * The seal primitive (`sealWithPassphrase`/`openWithPassphrase`, Argon2id →
 * AES-GCM) is the same one the device-pairing flow uses (see pairing.ts). The
 * seed is sealed once per enrolled method (it is tiny, so two copies is fine).
 *
 * The native variant (storage.native.ts) keeps using expo-secure-store, where
 * the OS already encrypts at rest — no PIN/passkey there.
 */
import { openWithPassphrase, sealWithPassphrase } from '@drakkar.software/starfish-identities';

import { evalPasskey, passkeySupported as webauthnSupported } from './passkey';
import type { LoadResult, PersistedSession, SeedLock, UnlockMethod } from './storage-types';

export type { PersistedSession } from './storage-types';

const KEY = 'octochat.session.v1';

/** A `sealWithPassphrase` output blob (opaque, JSON-serializable). */
type Sealed = Record<string, unknown>;

/** Versioned localStorage envelope. `pin` is always present; `passkey` optional. */
interface Envelope {
  v: 2;
  pin: Sealed;
  passkey?: { credentialId: string; salt: string; sealed: Sealed };
}

function ls(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
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
    if (obj?.v === 2 && obj.pin) return obj as Envelope;
  } catch {
    /* fall through to cleanup */
  }
  // Unrecognized value at our key — most likely a legacy plaintext seed from
  // before the sealed v:2 envelope. There's no backward-compat unlock, but we
  // must NOT leave a cleartext secret on disk: drop it so the "seed is never
  // persisted in cleartext" guarantee holds for users upgrading.
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return null;
}

function seedToBytes(s: PersistedSession): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(s));
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
  const env: Envelope = { v: 2, pin: (await sealWithPassphrase(lock.pin, bytes)) as unknown as Sealed };
  // The passkey was already enrolled by the UI (WebAuthn needs a fresh gesture,
  // so it runs before this heavy seal); here we just seal a copy with its secret.
  if (lock.passkey) {
    const { credentialId, salt, secretHex } = lock.passkey;
    env.passkey = { credentialId, salt, sealed: (await sealWithPassphrase(secretHex, bytes)) as unknown as Sealed };
  }
  ls()?.setItem(KEY, JSON.stringify(env));
}

export async function unlockSession(method: UnlockMethod, pin?: string): Promise<PersistedSession> {
  const env = readEnvelope();
  if (!env) throw new Error('No saved account to unlock.');

  if (method === 'passkey') {
    if (!env.passkey) throw new Error('No passkey is enrolled.');
    const secretHex = await evalPasskey(env.passkey.credentialId, env.passkey.salt);
    return bytesToSeed(await openWithPassphrase(secretHex, env.passkey.sealed as never));
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
