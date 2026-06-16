/**
 * Offline-first profile cache — re-exported from octospaces-sdk.
 * Note: cache keys migrate from `octochat.profile.v1.*` to `octospaces.profile.v1.*`
 * on upgrade (one-time cold cache, accepted trade-off).
 */
export { cacheProfile, loadCachedProfile } from '@drakkar.software/octospaces-sdk';
