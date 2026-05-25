import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory kv (the web kv is localStorage, absent under Node).
vi.mock('./kv', () => {
  const store = new Map<string, string>();
  return {
    kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
    kvSet: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    kvRemove: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    __store: store,
  };
});

import { clearMemberCaps, getMemberCap, hydrateMemberCaps } from './member-caps';
import * as kv from './kv';

const store = (kv as unknown as { __store: Map<string, string> }).__store;
const KEY = (u: string) => `octochat.membercaps.${u}`;

beforeEach(() => {
  clearMemberCaps();
  store.clear();
  vi.clearAllMocks();
});

describe('hydrateMemberCaps', () => {
  // The durable server caps now come from the caller (session-context reads the
  // `_spaces` doc once); this module merges them over the local kv cache.
  it('lets server caps win over the local cache, keeping local-only entries', async () => {
    store.set(KEY('u1'), JSON.stringify({ 'sp-a': 'LOCAL', 'sp-c': 'LOCAL-C' }));
    await hydrateMemberCaps('u1', { 'sp-a': 'SERVER', 'sp-b': 'SERVER-B' });
    expect(getMemberCap('sp-a')).toBe('SERVER'); // server overrides local
    expect(getMemberCap('sp-b')).toBe('SERVER-B'); // server-only
    expect(getMemberCap('sp-c')).toBe('LOCAL-C'); // local-only retained
  });

  it('recovers caps from the server on a fresh device (empty kv)', async () => {
    await hydrateMemberCaps('u2', { 'sp-a': 'SERVER' });
    expect(getMemberCap('sp-a')).toBe('SERVER');
  });

  it('keeps the local kv when no server caps are supplied (unreachable read)', async () => {
    store.set(KEY('u3'), JSON.stringify({ 'sp-a': 'LOCAL' }));
    await hydrateMemberCaps('u3', {});
    expect(getMemberCap('sp-a')).toBe('LOCAL');
  });

  it('warms the local kv with the merged set for the next offline open', async () => {
    store.set(KEY('u4'), JSON.stringify({ 'sp-a': 'LOCAL' }));
    await hydrateMemberCaps('u4', { 'sp-b': 'SERVER-B' });
    expect(JSON.parse(store.get(KEY('u4'))!)).toEqual({ 'sp-a': 'LOCAL', 'sp-b': 'SERVER-B' });
  });

  it('returns null for an unknown space', async () => {
    await hydrateMemberCaps('u5', {});
    expect(getMemberCap('nope')).toBeNull();
  });
});
