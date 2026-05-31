/**
 * Persisted accounts (web). The recovery seeds are the master secrets, so they are
 * NEVER stored in cleartext: localStorage holds only an AEAD envelope, and the key
 * that opens it is derived from a secret that is not on disk — a user PIN (always)
 * and, optionally, a WebAuthn passkey's PRF secret. A disk/localStorage scraper
 * therefore recovers only ciphertext.
 *
 * Multiple accounts under ONE app-lock. All accounts live in a single {@link Vault}
 * sealed as a unit, so the user unlocks once and then switches/adds/removes accounts
 * freely. To keep those mutations fast, the vault is sealed under a random 32-byte
 * **Vault Master Key (VMK)** via AES-GCM (cheap), and only the VMK is wrapped by the
 * expensive secrets:
 *  - PIN — ~20 bits, so it is Argon2id-stretched (`sealWithPassphrase`) to make
 *    offline brute-force of the VMK costly. Run ONCE at unlock.
 *  - Passkey PRF secret — 256 bits, uniformly random; stretching buys nothing, so it
 *    keys AES-GCM directly. Near-instant.
 * After a successful unlock the VMK lives only in the module-scope `vmk` closure
 * below (NOT React state, NOT sessionStorage) so add/switch/remove re-seal the vault
 * with one fast AES-GCM op — no Argon2id, no second seed derivation.
 *
 * The native variant (storage.native.ts) keeps using expo-secure-store, where the OS
 * already encrypts at rest — no PIN/passkey/VMK there.
 */
import { openWithPassphrase, sealWithPassphrase } from '@drakkar.software/starfish-identities';

import { evalPasskey, passkeySupported as webauthnSupported } from './passkey';
import { bytesToHex } from './paths';
import type { PasskeyEnrollment, PersistedSession, SeedLock, UnlockMethod, Vault, VaultLoad } from './storage-types';

export type { PersistedSession } from './storage-types';

const KEY = 'octochat.session.v1';
const IV_BYTES = 12;
const VMK_BYTES = 32;

/** A `sealWithPassphrase` output blob (opaque, JSON-serializable). */
type Sealed = Record<string, unknown>;

/** An AES-GCM ciphertext + its IV. Both hex. */
interface AesBlob {
  iv: string;
  ct: string;
}

/** Passkey wrap of the VMK: AES-GCM under the PRF secret (no Argon2id). Values hex. */
interface PasskeyWrap extends AesBlob {
  credentialId: string;
  salt: string;
  kind: 'aes-gcm';
}

/**
 * Versioned localStorage envelope. The VMK is wrapped by the PIN (`pinWrap`) and,
 * optionally, a passkey (`passkeyWrap`); `vault` is the account set sealed under the
 * VMK. `pinWrap` is present for every vault created through onboarding (PIN is
 * mandatory there); it is only ever absent for a vault migrated in via passkey alone.
 */
interface Envelope {
  v: 4;
  pinWrap?: Sealed;
  passkeyWrap?: PasskeyWrap;
  vault: AesBlob;
}

/** Legacy single-account envelope (pre-multi-account). Migrated to v4 on first unlock. */
interface LegacyV3 {
  v: 3;
  pin: Sealed;
  passkey?: PasskeyWrap;
}

// The decrypted Vault Master Key (hex), held in memory after a successful unlock so
// add/switch/remove re-seal the vault without re-running Argon2id. Cleared on
// clearVault(). Deliberately module-scope, never React state or sessionStorage.
let vmk: string | null = null;

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
async function aesGcmSeal(keyHex: string, plaintext: Uint8Array<ArrayBuffer>): Promise<AesBlob> {
  const key = await globalThis.crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(IV_BYTES);
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: bytesToHex(iv), ct: bytesToHex(new Uint8Array(ct)) };
}

/** Inverse of {@link aesGcmSeal}. Throws on wrong key / tampered ciphertext. */
async function aesGcmOpen(keyHex: string, blob: AesBlob): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(blob.iv) },
    key,
    hexToBytes(blob.ct),
  );
  return new Uint8Array(pt);
}

function readStored(): Envelope | LegacyV3 | null {
  let raw: string | null | undefined;
  try {
    raw = ls()?.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<Envelope> & Partial<LegacyV3>;
    if (obj?.v === 4 && obj.vault) return obj as Envelope;
    if (obj?.v === 3 && obj.pin) return obj as LegacyV3;
  } catch {
    /* fall through to cleanup */
  }
  // Unrecognized value at our key — a legacy plaintext seed or a too-old envelope.
  // There's no unlock for it, but we must NOT leave a stale secret on disk: drop it
  // so the "seed is never persisted in cleartext" guarantee holds. The user
  // re-onboards with their seed words.
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return null;
}

function writeEnvelope(env: Envelope): void {
  ls()?.setItem(KEY, JSON.stringify(env));
}

function vaultToBytes(v: Vault): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(v)) as Uint8Array<ArrayBuffer>;
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function methodsFor(hasPin: boolean, hasPasskey: boolean): UnlockMethod[] {
  const methods: UnlockMethod[] = [];
  if (hasPin) methods.push('pin');
  // Offer passkey only if one is enrolled AND this browser can still run WebAuthn.
  if (hasPasskey && webauthnSupported()) methods.push('passkey');
  return methods;
}

export async function loadVault(): Promise<VaultLoad> {
  const stored = readStored();
  if (!stored) return { kind: 'none' };
  const methods =
    stored.v === 4
      ? methodsFor(!!stored.pinWrap, !!stored.passkeyWrap)
      : methodsFor(true, !!stored.passkey);
  if (methods.length === 0) return { kind: 'none' };
  return { kind: 'locked', methods };
}

/**
 * Enrolled unlock methods for the persisted vault, regardless of lock state. loadVault
 * only reports these while a vault is *locked*; this lets an already-unlocked session
 * re-prompt the user (e.g. to reveal a seed) with the same PIN/passkey choices. Empty
 * when nothing is persisted. Synchronous (reads localStorage).
 */
export function vaultMethods(): UnlockMethod[] {
  const stored = readStored();
  if (!stored) return [];
  return stored.v === 4
    ? methodsFor(!!stored.pinWrap, !!stored.passkeyWrap)
    : methodsFor(true, !!stored.passkey);
}

/** Unwrap the VMK from a v4 envelope using the chosen method, caching it in memory. */
async function unwrapVmk(env: Envelope, method: UnlockMethod, pin?: string): Promise<Uint8Array> {
  if (method === 'passkey') {
    if (!env.passkeyWrap) throw new Error('No passkey is enrolled.');
    const secretHex = await evalPasskey(env.passkeyWrap.credentialId, env.passkeyWrap.salt);
    return aesGcmOpen(secretHex, env.passkeyWrap);
  }
  if (!env.pinWrap) throw new Error('No PIN is set.');
  if (!pin) throw new Error('Enter your PIN.');
  try {
    return await openWithPassphrase(pin, env.pinWrap as never);
  } catch {
    throw new Error('Wrong PIN.');
  }
}

/**
 * Migrate a legacy single-account v3 blob to a v4 vault, transparently, on unlock.
 * We open the one sealed session with the supplied method, wrap a fresh VMK under
 * that SAME secret (so the same unlock keeps working), and rewrite as v4. The other
 * method is dropped — the v3 PIN block can't be carried into a passkey unlock and
 * vice-versa — but the user keeps a working unlock and can re-add the other later.
 */
async function migrateV3(stored: LegacyV3, method: UnlockMethod, pin?: string): Promise<Vault> {
  let sessionBytes: Uint8Array;
  let prfHex: string | undefined;
  if (method === 'passkey') {
    if (!stored.passkey) throw new Error('No passkey is enrolled.');
    prfHex = await evalPasskey(stored.passkey.credentialId, stored.passkey.salt);
    sessionBytes = await aesGcmOpen(prfHex, stored.passkey);
  } else {
    if (!pin) throw new Error('Enter your PIN.');
    try {
      sessionBytes = await openWithPassphrase(pin, stored.pin as never);
    } catch {
      throw new Error('Wrong PIN.');
    }
  }
  const session = parseJson<PersistedSession>(sessionBytes);
  const vault: Vault = { accounts: [session], activeId: session.derived?.userId ?? '' };

  const vmkBytes = randomBytes(VMK_BYTES);
  vmk = bytesToHex(vmkBytes);
  const env: Envelope = { v: 4, vault: await aesGcmSeal(vmk, vaultToBytes(vault)) };
  if (method === 'passkey' && stored.passkey && prfHex) {
    const { iv, ct } = await aesGcmSeal(prfHex, vmkBytes);
    env.passkeyWrap = { credentialId: stored.passkey.credentialId, salt: stored.passkey.salt, kind: 'aes-gcm', iv, ct };
  } else if (pin) {
    env.pinWrap = (await sealWithPassphrase(pin, vmkBytes)) as unknown as Sealed;
  }
  writeEnvelope(env);
  return vault;
}

export async function unlockVault(method: UnlockMethod, pin?: string): Promise<Vault> {
  const stored = readStored();
  if (!stored) throw new Error('No saved account to unlock.');
  if (stored.v === 3) return migrateV3(stored, method, pin);

  const vmkBytes = await unwrapVmk(stored, method, pin);
  vmk = bytesToHex(vmkBytes);
  return parseJson<Vault>(await aesGcmOpen(vmk, stored.vault));
}

/**
 * Persist the vault. With an unlocked VMK in memory (the add/switch/remove path) this
 * re-seals only the vault block under the existing wraps — one fast AES-GCM op, no
 * Argon2id. The first-time path (onboarding) needs `lock` to mint the VMK + wraps.
 */
export async function saveVault(vault: Vault, lock?: SeedLock): Promise<void> {
  const bytes = vaultToBytes(vault);

  // Fast path: a live VMK + existing wraps on disk → re-seal the vault only. Skipped
  // when a `lock` is supplied: a lock means "establish the app-lock" (first
  // onboarding), which must mint a fresh VMK + wraps below rather than silently
  // reusing the existing ones — so add/switch/remove (no lock) re-seal fast, while
  // signIn always creates a fresh sealed vault.
  if (vmk && !lock?.pin) {
    const stored = readStored();
    if (stored && stored.v === 4) {
      writeEnvelope({
        v: 4,
        pinWrap: stored.pinWrap,
        passkeyWrap: stored.passkeyWrap,
        vault: await aesGcmSeal(vmk, bytes),
      });
      return;
    }
    // No v4 wraps on disk yet (e.g. migration wrote then was cleared) — fall through
    // to mint fresh wraps if a lock is supplied.
  }

  // First seal: mint a VMK and wrap it under the PIN (+ optional passkey).
  if (!lock?.pin) throw new Error('A PIN is required to secure your account on the web.');
  const vmkBytes = randomBytes(VMK_BYTES);
  vmk = bytesToHex(vmkBytes);
  const env: Envelope = {
    v: 4,
    pinWrap: (await sealWithPassphrase(lock.pin, vmkBytes)) as unknown as Sealed,
    vault: await aesGcmSeal(vmk, bytes),
  };
  // The passkey was already enrolled by the UI (WebAuthn needs a fresh gesture, so it
  // runs before this seal); here we just AES-GCM the VMK under its PRF secret.
  if (lock.passkey) {
    const { credentialId, salt, secretHex } = lock.passkey;
    const { iv, ct } = await aesGcmSeal(secretHex, vmkBytes);
    env.passkeyWrap = { credentialId, salt, kind: 'aes-gcm', iv, ct };
  }
  writeEnvelope(env);
}

export function passkeySupported(): boolean {
  return webauthnSupported();
}

/**
 * Add a passkey unlock to an ALREADY-UNLOCKED vault (the settings flow). The VMK is
 * live in memory, so we wrap it under the new PRF secret with one fast AES-GCM op —
 * no Argon2id, so no fresh-gesture timing to choreograph — and write the resulting
 * `passkeyWrap` beside the existing `pinWrap`. The vault block is unchanged (same VMK),
 * so it is reused as-is. The UI enrolls the passkey on a fresh gesture and hands the
 * enrollment here.
 */
export async function addPasskeyToVault(passkey: PasskeyEnrollment): Promise<void> {
  if (!vmk) throw new Error('Unlock your account before adding a passkey.');
  const stored = readStored();
  if (!stored || stored.v !== 4) throw new Error('No unlocked vault to add a passkey to.');
  const { credentialId, salt, secretHex } = passkey;
  const { iv, ct } = await aesGcmSeal(secretHex, hexToBytes(vmk));
  writeEnvelope({
    v: 4,
    pinWrap: stored.pinWrap,
    passkeyWrap: { credentialId, salt, kind: 'aes-gcm', iv, ct },
    vault: stored.vault,
  });
}

/**
 * Drop the passkey unlock from the vault (the settings flow). Idempotent when none is
 * enrolled. Refuses to remove the only unlock method — a PIN wrap MUST remain, so a
 * user can never lock themselves out by toggling the passkey off.
 */
export async function removePasskeyFromVault(): Promise<void> {
  const stored = readStored();
  if (!stored || stored.v !== 4) throw new Error('No unlocked vault.');
  if (!stored.passkeyWrap) return;
  if (!stored.pinWrap) throw new Error('Cannot remove the only unlock method.');
  writeEnvelope({ v: 4, pinWrap: stored.pinWrap, vault: stored.vault });
}

export async function clearVault(): Promise<void> {
  vmk = null;
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
