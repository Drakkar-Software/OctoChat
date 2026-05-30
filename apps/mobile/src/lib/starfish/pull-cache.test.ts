import { beforeEach, describe, expect, it, vi } from 'vitest';

// Back the adapter with an in-memory kv so we can assert the exact stored key
// (the adapter's only job is to prefix the SDK's document-path key and delegate).
const store = new Map<string, string>();
vi.mock('./kv', () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
}));

import { pullCache, PULL_CACHE_MAX_AGE_MS } from './pull-cache';

describe('pullCache', () => {
  beforeEach(() => store.clear());

  it('round-trips a value under the octochat.pullcache.<key> prefix', async () => {
    const cache = pullCache();
    await cache.set('/v1/octochat/pull/spaces/u/_spaces', '{"hello":1}');
    // Stored under the prefixed key…
    expect(store.get('octochat.pullcache./v1/octochat/pull/spaces/u/_spaces')).toBe('{"hello":1}');
    // …and read back by the same logical key.
    expect(await cache.get('/v1/octochat/pull/spaces/u/_spaces')).toBe('{"hello":1}');
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
