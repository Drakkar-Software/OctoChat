/**
 * Shared types for the persisted-session storage layer. Both platform variants
 * (`storage.ts` web, `storage.native.ts` native) implement the same contract so
 * `session-context` stays platform-agnostic.
 */
import type { DeviceKeys } from './client';

/**
 * The root identity already derived from the seed (userId + device keys). Caching
 * it lets unlock/cold-start skip the heavy `bootstrapRootIdentity` Argon2id — the
 * single biggest cost on the restore path. Equivalent in sensitivity to the seed
 * (it derives deterministically from it), so it lives inside the same sealed blob
 * (web) / Keychain entry (native), never in cleartext.
 */
export interface DerivedIdentity {
  userId: string;
  keys: DeviceKeys;
}

/** The recovery seed + display name — the minimum needed to re-derive an identity. */
export interface PersistedSession {
  seed: string[];
  name: string;
  /**
   * Cached root identity so restore skips the bootstrap Argon2id. Optional: if
   * absent (or corrupt) the consumer falls back to re-deriving from `seed`.
   */
  derived?: DerivedIdentity;
}

/**
 * Every account held on this device plus which one is active. The whole vault is
 * sealed as a unit (web: under one app-lock via a vault master key; native: a
 * single secure-store entry), so unlocking once makes every account available and
 * switching is an in-memory pointer flip — no re-deriving the others. `activeId`
 * is a member `userId`; an empty `accounts` array means "fully signed out".
 */
export interface Vault {
  accounts: PersistedSession[];
  activeId: string;
}

/** Ways the web-persisted seed can be unlocked. */
export type UnlockMethod = 'pin' | 'passkey';

/** A registered passkey + the PRF secret used to seal the seed for it. */
export interface PasskeyEnrollment {
  /** Credential id, hex — passed back as `allowCredentials` at unlock. */
  credentialId: string;
  /** PRF input salt, hex — replayed to re-derive the same secret at unlock. */
  salt: string;
  /** Hex of the 32-byte PRF secret used to seal the seed. */
  secretHex: string;
}

/**
 * How to lock the seed when persisting it (web only; ignored on native, which
 * relies on the OS Keychain/Keystore). A PIN is always required on web; a passkey
 * is an optional, stronger second unlock method. The passkey is enrolled by the
 * UI on a fresh user gesture (WebAuthn needs one) BEFORE the heavy key derivation,
 * so the already-derived enrollment is handed here rather than a "please enroll" flag.
 */
export interface SeedLock {
  pin: string;
  passkey?: PasskeyEnrollment;
}

/**
 * Result of probing storage at launch:
 * - `none`   — nothing stored; start signed-out.
 * - `ready`  — vault available immediately (native Keychain path).
 * - `locked` — a sealed vault exists; unlock with one of `methods` (web path).
 */
export type VaultLoad =
  | { kind: 'none' }
  | { kind: 'ready'; vault: Vault }
  | { kind: 'locked'; methods: UnlockMethod[] };
