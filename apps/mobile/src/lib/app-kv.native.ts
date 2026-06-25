/**
 * Native kv backend — MMKV via JSI (synchronous, no bridge round-trips).
 * Replaces the AsyncStorage adapter used on web (app-kv.ts) for all app-side
 * caching: the spaces snapshot, and (via configureKv in octochat-init.ts) the
 * SDK's pull-cache, profile-cache, space-access store, reads/mutes, etc.
 *
 * One-time migration: on the first boot after this module is introduced we copy
 * existing AsyncStorage keys under the `octospaces.*` and `octochat.*` prefixes
 * to MMKV. The flag check runs synchronously at module-init; the copy itself is
 * deferred behind InteractionManager.runAfterInteractions to avoid competing with
 * session-context's first kv reads on the same boot frame.
 */
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';

const kv = new MMKV({ id: 'octochat-kv' });

const MIGRATION_FLAG = 'octochat.kv-migrated.v1';

if (!kv.getString(MIGRATION_FLAG)) {
  // Defer off the first frame — this bridge burst competes with session-context's
  // first kv reads. SpacesProvider degrades to refresh() if the snapshot isn't
  // ready yet; the migration back-fills before the next launch. One-time only
  // (bounded to the single post-upgrade boot where MIGRATION_FLAG is absent).
  InteractionManager.runAfterInteractions(() => {
    void (async () => {
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const ourKeys = allKeys.filter(
          (k) => k.startsWith('octospaces.') || k.startsWith('octochat.'),
        );
        if (ourKeys.length > 0) {
          const pairs = await AsyncStorage.multiGet(ourKeys);
          for (const [k, v] of pairs) {
            if (k && v != null) kv.set(k, v);
          }
        }
        kv.set(MIGRATION_FLAG, '1');
      } catch (e) {
        console.warn('[app-kv] AsyncStorage→MMKV migration failed', e);
        // Flag not set — will retry on next boot.
      }
    })();
  });
}

export const kvGet = (key: string): Promise<string | null> =>
  Promise.resolve(kv.getString(key) ?? null);

export const kvSet = (key: string, value: string): Promise<void> => {
  kv.set(key, value);
  return Promise.resolve();
};

export const kvRemove = (key: string): Promise<void> => {
  kv.delete(key);
  return Promise.resolve();
};
