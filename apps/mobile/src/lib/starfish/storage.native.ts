/**
 * Persisted accounts on native — the {@link Vault} (every account's recovery seed +
 * which is active) in the device Keychain/Keystore via expo-secure-store, which
 * encrypts at rest. There is no PIN/passkey/VMK here (that's the web path in
 * storage.ts): the OS already protects the store, so the vault restores directly and
 * `status` is never 'locked'. Switching/adding/removing an account just rewrites the
 * one secure-store entry.
 */
import * as SecureStore from 'expo-secure-store';

import type { PasskeyEnrollment, PersistedSession, SeedLock, UnlockMethod, Vault, VaultLoad } from './storage-types';

export type { PersistedSession } from './storage-types';

const KEY = 'octochat_session_v1';

/** Coerce whatever is stored into a Vault — promoting a legacy single PersistedSession. */
function asVault(raw: string): Vault | null {
  try {
    const obj = JSON.parse(raw) as Partial<Vault> & Partial<PersistedSession>;
    if (Array.isArray(obj.accounts)) return obj as Vault;
    // Legacy single-account entry (a bare PersistedSession): wrap it.
    if (Array.isArray(obj.seed)) {
      const session = obj as PersistedSession;
      return { accounts: [session], activeId: session.derived?.userId ?? '' };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function saveVault(v: Vault, _lock?: SeedLock): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export async function loadVault(): Promise<VaultLoad> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return { kind: 'none' };
    const vault = asVault(raw);
    if (!vault || vault.accounts.length === 0) return { kind: 'none' };
    return { kind: 'ready', vault };
  } catch (error) {
    // A read error is NOT "no account" — the vault is still in Keychain. Returning
    // 'none' here caused cold-start welcome-screen flashes (the user's identity
    // appeared wiped). Surface the error so the caller can keep the splash up.
    console.error('[storage.native] loadVault failed', error);
    return { kind: 'error', error };
  }
}

// Native restores directly from the Keychain — there is no lock screen to unlock.
export async function unlockVault(_method: UnlockMethod, _pin?: string): Promise<Vault> {
  throw new Error('unlockVault is not used on native.');
}

export function passkeySupported(): boolean {
  return false;
}

// Passkeys are a web-vault concept (storage.ts). Native has no PIN/VMK to wrap, so the
// app-lock here is OS biometrics (see app-lock.native.ts), not a passkey. These keep
// the cross-platform contract so session-context can call them unconditionally.
export async function addPasskeyToVault(_passkey: PasskeyEnrollment): Promise<void> {
  throw new Error('Passkeys are not used on native.');
}

export async function removePasskeyFromVault(): Promise<void> {
  /* no passkey wrap on native — nothing to remove */
}

// No app-lock on native (the OS protects the store), so there is nothing to re-prompt.
export function vaultMethods(): UnlockMethod[] {
  return [];
}

export async function clearVault(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
