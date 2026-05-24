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

// Control the durable server tier. Mocking ./registry also avoids loading ./paths → ./config.
const readSpaces = vi.fn();
vi.mock('./registry', () => ({ readSpaces: (...args: unknown[]) => readSpaces(...args) }));

import { clearMemberCaps, getMemberCap, hydrateMemberCaps } from './member-caps';
import * as kv from './kv';

const store = (kv as unknown as { __store: Map<string, string> }).__store;
const KEY = (u: string) => `octochat.membercaps.${u}`;
const client = {} as never; // readSpaces is mocked, so the client is unused

beforeEach(() => {
  clearMemberCaps();
  store.clear();
  vi.clearAllMocks();
});

describe('hydrateMemberCaps', () => {
  it('lets server caps win over the local cache, keeping local-only entries', async () => {
    store.set(KEY('u1'), JSON.stringify({ 'sp-a': 'LOCAL', 'sp-c': 'LOCAL-C' }));
    readSpaces.mockResolvedValue({ spaces: [], caps: { 'sp-a': 'SERVER', 'sp-b': 'SERVER-B' }, hash: 'h' });
    await hydrateMemberCaps('u1', client);
    expect(getMemberCap('sp-a')).toBe('SERVER'); // server overrides local
    expect(getMemberCap('sp-b')).toBe('SERVER-B'); // server-only
    expect(getMemberCap('sp-c')).toBe('LOCAL-C'); // local-only retained
  });

  it('recovers caps from the server on a fresh device (empty kv)', async () => {
    readSpaces.mockResolvedValue({ spaces: [], caps: { 'sp-a': 'SERVER' }, hash: 'h' });
    await hydrateMemberCaps('u2', client);
    expect(getMemberCap('sp-a')).toBe('SERVER');
  });

  it('falls back to the local kv when the server is unreachable', async () => {
    store.set(KEY('u3'), JSON.stringify({ 'sp-a': 'LOCAL' }));
    readSpaces.mockRejectedValue(new Error('offline'));
    await hydrateMemberCaps('u3', client);
    expect(getMemberCap('sp-a')).toBe('LOCAL');
  });

  it('warms the local kv with the merged set for the next offline open', async () => {
    store.set(KEY('u4'), JSON.stringify({ 'sp-a': 'LOCAL' }));
    readSpaces.mockResolvedValue({ spaces: [], caps: { 'sp-b': 'SERVER-B' }, hash: 'h' });
    await hydrateMemberCaps('u4', client);
    expect(JSON.parse(store.get(KEY('u4'))!)).toEqual({ 'sp-a': 'LOCAL', 'sp-b': 'SERVER-B' });
  });

  it('returns null for an unknown space', async () => {
    readSpaces.mockResolvedValue({ spaces: [], caps: {}, hash: null });
    await hydrateMemberCaps('u5', client);
    expect(getMemberCap('nope')).toBeNull();
  });
});
