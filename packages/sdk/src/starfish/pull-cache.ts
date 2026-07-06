// pullCache / PULL_CACHE_MAX_AGE_MS were removed from octospaces-sdk in 0.24.
// Reimplemented here using createKvPullCache from starfish-client so the public
// surface of octochat-sdk stays stable — consumers (use-merge-doc.ts etc.) see
// no change.
import { createKvPullCache } from '@drakkar.software/starfish-client';
import { kvGet, kvSet, kvRemove } from '@drakkar.software/dk-spaces-sdk';

/** 30 days — mirrors the default from the old octospaces pullCache. */
export const PULL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** HTTP status codes that trigger a stale cache-fallback (rate-limit + server errors). */
export const CACHE_FALLBACK_STATUSES = [429, 500, 502, 503, 504] as const;

/** Singleton cache instance — created on first call and reused like the original octospaces pullCache. */
let _cache: ReturnType<typeof createKvPullCache> | null = null;

/**
 * Returns the shared KV-backed pull-cache singleton. Pass it as `cache:` in every
 * `useSyncInit` / `useSharedSyncStore` / `useMergeDoc` call-site.
 */
export function pullCache() {
  if (!_cache) {
    _cache = createKvPullCache(
      { getItem: kvGet, setItem: kvSet, removeItem: kvRemove },
      { prefix: 'octospaces.pullcache.', maxAgeMs: PULL_CACHE_MAX_AGE_MS },
    );
  }
  return _cache;
}
