/**
 * Platform adapters the headless SDK needs the host app to provide.
 *
 * The SDK can't do Metro `.native.ts` file-extension resolution and must not bind
 * to localStorage / AsyncStorage / SecureStore directly, so the host injects a
 * key/value store at boot via {@link configureKv}. This holds account-scoped state
 * the SDK persists offline (joined-space member caps, the public-space access map,
 * read marks, mutes, profile/pull caches).
 */

/** Async key/value store — web `localStorage`, native `AsyncStorage`, etc. */
export interface KvAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

let kv: KvAdapter | null = null;

/** Install the host's key/value store. Call once at app boot. */
export function configureKv(adapter: KvAdapter): void {
  kv = adapter;
}

/** The configured KV store, or throw if the host never called {@link configureKv}. */
export function getKv(): KvAdapter {
  if (!kv) throw new Error('octochat-sdk: configureKv() not called — wire it at app boot.');
  return kv;
}

// Free-function shims matching the app's historical `kv` module surface, so the
// migrated sync modules read/write through the injected adapter unchanged.
export const kvGet = (key: string): Promise<string | null> => getKv().get(key);
export const kvSet = (key: string, value: string): Promise<void> => getKv().set(key, value);
export const kvRemove = (key: string): Promise<void> => getKv().remove(key);
