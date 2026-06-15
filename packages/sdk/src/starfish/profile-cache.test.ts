/**
 * Tests for the offline-first profile cache (pins the `octochat.profile.v1.` prefix
 * so any future KV-key change is caught — changing it would orphan cached offline data).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../config/adapters', () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  kvRemove: vi.fn(async (k: string) => void store.delete(k)),
}));

import { cacheProfile, loadCachedProfile } from './profile-cache';

const PROFILE = { pseudo: 'alice', avatar: 'https://example.com/a.png', edPub: 'aa', kemPub: 'bb' };

beforeEach(() => store.clear());

describe('cacheProfile', () => {
  it('writes under the octochat.profile.v1.<userId> key (prefix lock-in)', async () => {
    cacheProfile('u-abc', PROFILE);
    // Give the fire-and-forget a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    const raw = store.get('octochat.profile.v1.u-abc');
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
    store.set('octochat.profile.v1.u-bad', 'not-json{{{');
    expect(await loadCachedProfile('u-bad')).toBeNull();
  });

  it('returns null for missing fields (partial stored object)', async () => {
    store.set('octochat.profile.v1.u-partial', JSON.stringify({ pseudo: 'bob' }));
    const loaded = await loadCachedProfile('u-partial');
    expect(loaded).toEqual({ pseudo: 'bob', avatar: null, edPub: null, kemPub: null });
  });

  it('returns null for non-string pseudo/avatar/edPub/kemPub', async () => {
    store.set('octochat.profile.v1.u-typed', JSON.stringify({ pseudo: 42, avatar: true }));
    const loaded = await loadCachedProfile('u-typed');
    expect(loaded).toEqual({ pseudo: null, avatar: null, edPub: null, kemPub: null });
  });
});
