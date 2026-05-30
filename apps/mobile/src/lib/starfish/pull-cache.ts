/**
 * The app's offline-first read cache for every {@link StarfishClient}.
 *
 * Backs the SDK's {@link PullCache} (read-through pull cache, added in
 * starfish-client 3.0.0-alpha.15) with our existing kv layer (localStorage on
 * web, AsyncStorage on native). When a client is built with this cache, every
 * successful structured `pull()` is written through, and a pull that fails
 * because the transport is unreachable falls back to the last-synced snapshot —
 * so spaces, rooms, the space `_keyring`, and room documents all survive offline.
 *
 * SECURITY: the SDK caches the RAW server response only. For our E2E (delegated)
 * collections that payload is the SEALED ciphertext the server holds — never the
 * decrypted form — so this cache is ciphertext-at-rest by construction;
 * decryption happens in memory on read (see the SDK's `SyncManager.seedFromCache`).
 *
 * Keys are the SDK's document path (namespace-prefixed, query stripped), which is
 * already scope-unique: `_spaces` is per-account (`spaces/<userId>`), while a
 * space `_keyring`/room doc is space-scoped — shared across accounts on the same
 * device only as identical ciphertext, which a wrong account simply can't decrypt.
 * So no extra per-identity prefixing is needed for correctness.
 */
import type { PullCache } from '@drakkar.software/starfish-client';

import { kvGet, kvSet } from './kv';

const PREFIX = 'octochat.pullcache.';

/**
 * Max age for a cached snapshot before it's treated as a miss. Generous (30 days)
 * because for an offline-first app any last-synced data beats none — this only
 * evicts truly ancient entries (e.g. a space not opened in a month) so the cache
 * can't grow unbounded with stale documents.
 */
export const PULL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let shared: PullCache | undefined;

/** The shared app-wide pull cache (one instance, reused across every client). */
export function pullCache(): PullCache {
  return (shared ??= {
    get: (key) => kvGet(PREFIX + key),
    set: (key, value) => kvSet(PREFIX + key, value),
  });
}
