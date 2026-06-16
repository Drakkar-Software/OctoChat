/**
 * Offline-first pull cache — re-exported from octospaces-sdk.
 * Note: the stored keys migrate from `octochat.pullcache.*` to `octospaces.pullcache.*`
 * on upgrade (one-time cold cache, accepted trade-off).
 */
export { pullCache, PULL_CACHE_MAX_AGE_MS } from '@drakkar.software/octospaces-sdk';
