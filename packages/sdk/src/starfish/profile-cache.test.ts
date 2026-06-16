/**
 * Tests for the offline-first profile cache. After the clean-break migration to
 * octospaces-sdk's shared implementation, the key prefix changed from
 * `octochat.profile.v1.` to `octospaces.profile.v1.` (accepted cold-cache on upgrade).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { configureKv } from '@drakkar.software/octospaces-sdk';
import { cacheProfile, loadCachedProfile } from '../index';

const store = new Map<string, string>();
const PROFILE = { pseudo: 'alice', avatar: 'https://example.com/a.png', edPub: 'aa', kemPub: 'bb' };

beforeEach(() => {
  store.clear();
  configureKv({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    remove: async (k) => { store.delete(k); },
  });
});

describe('cacheProfile', () => {
  it('writes under the octospaces.profile.v1.<userId> key (prefix lock-in)', async () => {
    cacheProfile('u-abc', PROFILE);
    await new Promise((r) => setTimeout(r, 0));
    const raw = store.get('octospaces.profile.v1.u-abc');
    expect(raw).not.toBeUndefined();
    expect(JSON.parse(raw!)).toMatchObject(PROFILE);
  });
});

describe('loadCachedProfile', () => {
  it('returns null for an uncached user', async () => {
    expect(await loadCachedProfile('u-nope')).toBeNull();
  });

  it('round-trips a full profile', async () => {
    cacheProfile('u-abc', PROFILE);
    await new Promise((r) => setTimeout(r, 0));
    const loaded = await loadCachedProfile('u-abc');
    expect(loaded).toEqual(PROFILE);
  });

  it('returns null and does not throw for malformed JSON', async () => {
    store.set('octospaces.profile.v1.u-bad', 'not-json{{{');
    expect(await loadCachedProfile('u-bad')).toBeNull();
  });

  it('returns null for missing fields (partial stored object)', async () => {
    store.set('octospaces.profile.v1.u-partial', JSON.stringify({ pseudo: 'bob' }));
    const loaded = await loadCachedProfile('u-partial');
    expect(loaded).toEqual({ pseudo: 'bob', avatar: null, edPub: null, kemPub: null });
  });

  it('returns null for non-string pseudo/avatar/edPub/kemPub', async () => {
    store.set('octospaces.profile.v1.u-typed', JSON.stringify({ pseudo: 42, avatar: true }));
    const loaded = await loadCachedProfile('u-typed');
    expect(loaded).toEqual({ pseudo: null, avatar: null, edPub: null, kemPub: null });
  });
});
