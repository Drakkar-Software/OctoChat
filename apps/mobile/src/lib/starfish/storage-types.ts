/**
 * Shared types for the persisted-session storage layer. Both platform variants
 * (`storage.ts` web, `storage.native.ts` native) implement the same contract so
 * `session-context` stays platform-agnostic.
 */

/** The recovery seed + display name — the minimum needed to re-derive an identity. */
export interface PersistedSession {
  seed: string[];
  name: string;
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
 * - `ready`  — session available immediately (native Keychain path).
 * - `locked` — a sealed seed exists; unlock with one of `methods` (web path).
 */
export type LoadResult =
  | { kind: 'none' }
  | { kind: 'ready'; session: PersistedSession }
  | { kind: 'locked'; methods: UnlockMethod[] };
