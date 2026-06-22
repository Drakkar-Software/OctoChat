/**
 * Tests for the pull cache. After the clean-break migration to octospaces-sdk's
 * shared implementation, the prefix changed from `octochat.pullcache.` to
 * `octospaces.pullcache.` (accepted cold-cache on upgrade).
 *
 * NOTE: createKvPullCache (starfish-client) wraps stored values in a JSON envelope
 * {payload, _cachedAt} — so raw KV store contents are NOT the bare string. Access
 * through `cache.get()` returns the unwrapped original value.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { configureKv } from '@drakkar.software/octospaces-sdk';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from '../index';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  configureKv({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    remove: async (k) => { store.delete(k); },
  });
});

describe('pullCache', () => {
  it('round-trips a value via the cache get/set interface', async () => {
    const cache = pullCache();
    await cache.set('/v1/octospaces/pull/spaces/u/_spaces', '{"hello":1}');
    // Read back through the cache interface (envelope is transparent to callers)
    expect(await cache.get('/v1/octospaces/pull/spaces/u/_spaces')).toBe('{"hello":1}');
  });

  it('stores under the octospaces.pullcache. prefix (key visible in raw kv)', async () => {
    const cache = pullCache();
    await cache.set('/my-key', 'value');
    // The key in KV is prefixed — the raw value is an envelope (not the bare string)
    const rawKeys = [...store.keys()];
    expect(rawKeys.some((k) => k.startsWith('octospaces.pullcache.'))).toBe(true);
  });

  it('returns null for a missing key', async () => {
    expect(await pullCache().get('/pull/nope')).toBeNull();
  });

  it('returns one shared instance', () => {
    expect(pullCache()).toBe(pullCache());
  });

  it('exposes a positive max-age', () => {
    expect(PULL_CACHE_MAX_AGE_MS).toBeGreaterThan(0);
  });
});
