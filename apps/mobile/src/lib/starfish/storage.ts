/**
 * Persisted session (web): the recovery seed + display name in localStorage so
 * the identity is re-derived on reload. The native variant (storage.native.ts)
 * uses expo-secure-store (Keychain/Keystore). POC-level — see native step.
 */
export interface PersistedSession {
  seed: string[];
  name: string;
}

const KEY = 'octochat.session.v1';

function ls(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

export async function saveSession(s: PersistedSession): Promise<void> {
  try {
    ls()?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const raw = ls()?.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersistedSession) : null;
  } catch {
    return null;
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
