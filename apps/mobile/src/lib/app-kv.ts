/**
 * App-side kv store — the storage backend for app-level caches (spaces snapshot,
 * etc.). On web this re-exports the platform-sdk's localStorage adapter; on native
 * it's overridden by app-kv.native.ts, which uses MMKV (synchronous JSI, no bridge
 * round-trips). Import from here — not from octochat-sdk/platform — so all app-side
 * caching goes through the same backend that gets swapped on native.
 */
export { kvGet, kvSet, kvRemove } from '@drakkar.software/octochat-sdk/platform';
