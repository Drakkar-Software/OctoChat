/**
 * Persisted session on native — the recovery seed + display name in the device
 * Keychain/Keystore via expo-secure-store. Mirrors the web storage interface.
 */
import * as SecureStore from 'expo-secure-store';

export interface PersistedSession {
  seed: string[];
  name: string;
}

const KEY = 'octochat_session_v1';

export async function saveSession(s: PersistedSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as PersistedSession) : null;
  } catch {
    return null;
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
