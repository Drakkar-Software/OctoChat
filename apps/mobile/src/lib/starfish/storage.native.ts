/**
 * Persisted session on native — the recovery seed + display name in the device
 * Keychain/Keystore via expo-secure-store, which encrypts at rest. There is no
 * PIN/passkey here (that's the web path in storage.ts): the OS already protects
 * the store, so the session restores directly and `status` is never 'locked'.
 */
import * as SecureStore from 'expo-secure-store';

import type { LoadResult, PersistedSession, SeedLock, UnlockMethod } from './storage-types';

export type { PersistedSession } from './storage-types';

const KEY = 'octochat_session_v1';

export async function saveSession(s: PersistedSession, _lock?: SeedLock): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export async function loadStoredSession(): Promise<LoadResult> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return { kind: 'none' };
    return { kind: 'ready', session: JSON.parse(raw) as PersistedSession };
  } catch {
    return { kind: 'none' };
  }
}

// Native restores directly from the Keychain — there is no lock screen to unlock.
export async function unlockSession(_method: UnlockMethod, _pin?: string): Promise<PersistedSession> {
  throw new Error('unlockSession is not used on native.');
}

export function passkeySupported(): boolean {
  return false;
}

export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
