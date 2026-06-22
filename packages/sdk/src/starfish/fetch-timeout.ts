// fetchWithTimeout / CONNECT_TIMEOUT_MS were removed from octospaces-sdk in 0.24.
// Reimplemented here using createTimeoutFetch from starfish-client/fetch.
import { createTimeoutFetch } from '@drakkar.software/starfish-client/fetch';

/** OctoChat's connection timeout: 12 s (octospaces used 12 s; starfish default is 10 s). */
export const CONNECT_TIMEOUT_MS = 12_000;

/**
 * Returns a timeout-wrapped `fetch` function that aborts after `ms` milliseconds.
 * Drop-in for the global `fetch` — pass to StarfishClient, useSyncInit, etc.
 * Default timeout preserves OctoChat's historic 12 s.
 */
export function fetchWithTimeout(ms = CONNECT_TIMEOUT_MS): typeof globalThis.fetch {
  return createTimeoutFetch(ms);
}
