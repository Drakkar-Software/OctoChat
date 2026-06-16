/**
 * Tests for the pull cache. After the clean-break migration to octospaces-sdk's
 * shared implementation, the prefix changed from `octochat.pullcache.` to
 * `octospaces.pullcache.` (accepted cold-cache on upgrade).
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
  it('round-trips a value under the octospaces.pullcache.<key> prefix', async () => {
    const cache = pullCache();
    await cache.set('/v1/octospaces/pull/spaces/u/_spaces', '{"hello":1}');
    // Stored under the SDK prefix (migrated from octochat.pullcache.*)
    expect(store.get('octospaces.pullcache./v1/octospaces/pull/spaces/u/_spaces')).toBe('{"hello":1}');
    expect(await cache.get('/v1/octospaces/pull/spaces/u/_spaces')).toBe('{"hello":1}');
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
