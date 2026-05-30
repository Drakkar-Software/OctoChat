/**
 * Shared types for the persisted-session storage layer. Both platform variants
 * (`storage.ts` web, `storage.native.ts` native) implement the same contract so
 * `session-context` stays platform-agnostic.
 */
import type { BootstrapOrigin } from '@drakkar.software/starfish-identities';
import type { CapCert } from '@drakkar.software/starfish-protocol';

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
  /**
   * BIP-39 recovery seed. Absent for non-seed origins (e.g. Nostr-derived
   * identities, where the secp256k1 root lives in the extension and re-login
   * is the recovery path). When absent, `derived` MUST be present — restore
   * has no fallback path.
   */
  seed?: string[];
  name: string;
  /**
   * Cached root identity so restore skips the bootstrap Argon2id. Optional: if
   * absent (or corrupt) the consumer falls back to re-deriving from `seed`.
   * Required when `seed` is absent.
   */
  derived?: DerivedIdentity;
  /**
   * How this identity was bootstrapped. Absent for seed-derived identities;
   * present (e.g. `{ kind: 'secp256k1', pubHex }`) for Nostr-derived ones.
   * Purely cosmetic — drives UI like the You-tab security card; never on the wire.
   */
  bootstrapOrigin?: BootstrapOrigin;
  /**
   * Root-signed cap-cert for a PAIRED (linked) device. Present ONLY for accounts
   * added via device pairing: such a device has a fresh keypair (≠ root) and so
   * cannot self-mint its caps — it must replay this delegated cert. When present
   * (and `seed` absent), restore rebuilds the session via `buildLinkedSession`
   * rather than re-deriving/self-minting. Sealed alongside `derived` (it grants
   * the same access), never in cleartext.
   */
  capCert?: CapCert;
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
 * - `error`  — storage read failed (e.g. transient Keychain miss on cold start).
 *   The caller MUST NOT collapse this into "no account" — the vault is still on
 *   disk; the symptom is a stuck splash instead of a wrongful welcome-screen.
 */
export type VaultLoad =
  | { kind: 'none' }
  | { kind: 'ready'; vault: Vault }
  | { kind: 'locked'; methods: UnlockMethod[] }
  | { kind: 'error'; error: unknown };
