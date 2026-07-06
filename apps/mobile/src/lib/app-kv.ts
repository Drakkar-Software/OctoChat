/**
 * App-side kv store — the storage backend for app-level caches (spaces snapshot,
 * etc.). On web this re-exports the platform-sdk's localStorage adapter; on native
 * it's overridden by app-kv.native.ts, which uses MMKV (synchronous JSI, no bridge
 * round-trips). Import from here — not from octochat-sdk/platform — so all app-side
 * caching goes through the same backend that gets swapped on native.
 */
export { kvGet, kvSet, kvRemove } from '@drakkar.software/octochat-sdk/platform';

// dk-spaces-sdk 0.32 rebased its KV prefixes off the `octospaces` namespace: the
// persisted space-access store moved `octospaces.spaceaccess.*` → `dk.spaceaccess.*`,
// and the profile cache moved (via starfish-spaces) `octospaces.profile.v1.*` →
// `starfish.profile.v1.*`. Both re-hydrate losslessly from the server on a cold-read
// miss, but we rename in place here to avoid that miss. One-time, mirrors the native
// migration in app-kv.native.ts (localStorage is directly enumerable, unlike the
// generic KvAdapter `get`/`set`/`remove` seam, so this can't live in the SDK).
// See MIGRATION_CLEANUP.md — remove once the rollout window has passed.
const PREFIX_MIGRATION_FLAG = 'dk-migration:v1:done';
const PREFIX_RENAMES: [from: string, to: string][] = [
  ['octospaces.spaceaccess.', 'dk.spaceaccess.'],
  ['octospaces.profile.v1.', 'starfish.profile.v1.'],
];

if (typeof globalThis.localStorage !== 'undefined' && !globalThis.localStorage.getItem(PREFIX_MIGRATION_FLAG)) {
  try {
    const ls = globalThis.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k) keys.push(k);
    }
    for (const key of keys) {
      for (const [from, to] of PREFIX_RENAMES) {
        if (!key.startsWith(from)) continue;
        const target = to + key.slice(from.length);
        if (ls.getItem(target) === null) {
          const value = ls.getItem(key);
          if (value != null) ls.setItem(target, value);
        }
        break;
      }
    }
    ls.setItem(PREFIX_MIGRATION_FLAG, '1');
  } catch (e) {
    console.warn('[app-kv] octospaces→dk/starfish KV prefix migration failed', e);
    // Flag not set — will retry on next boot. Cold-read miss in the meantime is
    // lossless (server re-hydrates both caches).
  }
}
