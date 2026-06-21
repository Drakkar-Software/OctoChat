import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureKv } from '@drakkar.software/octospaces-sdk';
import {
  flushReadsNow,
  getRoomReadAt,
  hydrateReads,
  loadReadMarksFromKv,
  resetReads,
  setRoomReadAt,
  subscribeReads,
} from './reads';

const store = new Map<string, string>();
const SESSION = { userId: 'u', accountClient: {}, spacesRegistryClient: {} } as never;

beforeEach(() => {
  store.clear();
  configureKv({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    remove: async (k) => { store.delete(k); },
  });
  resetReads();
});

describe('hydrateReads', () => {
  it('max-merges the server copy with kv and the legacy lastread map (highest wins)', async () => {
    store.set('octochat.reads.u', JSON.stringify({ rooms: { r1: 100, r2: 50 } }));
    store.set('octochat.lastread.u', JSON.stringify({ r2: 80, r3: 10 })); // legacy = bare map
    await hydrateReads('u', { nodes: { r1: 90, r4: 5 } });
    expect(getRoomReadAt('r1')).toBe(100); // kv 100 beats server 90
    expect(getRoomReadAt('r2')).toBe(80); // legacy 80 beats kv 50
    expect(getRoomReadAt('r3')).toBe(10);
    expect(getRoomReadAt('r4')).toBe(5);
  });

  it('does not roll back an un-flushed in-memory mark on a stale server read', async () => {
    setRoomReadAt(SESSION, 'r1', 500); // optimistic local mark, not yet flushed
    await hydrateReads('u', { nodes: { r1: 100 } }); // server still behind
    expect(getRoomReadAt('r1')).toBe(500);
  });
});

describe('loadReadMarksFromKv', () => {
  it('folds the legacy lastread map into the synced reads map', async () => {
    store.set('octochat.reads.u', JSON.stringify({ rooms: { r1: 100 } }));
    store.set('octochat.lastread.u', JSON.stringify({ r1: 50, r2: 70 }));
    expect(await loadReadMarksFromKv('u')).toEqual({ r1: 100, r2: 70 });
  });
});

describe('setRoomReadAt', () => {
  it('applies an optimistic max immediately and never regresses', () => {
    setRoomReadAt(SESSION, 'r1', 200);
    expect(getRoomReadAt('r1')).toBe(200);
    setRoomReadAt(SESSION, 'r1', 100); // older — ignored
    expect(getRoomReadAt('r1')).toBe(200);
  });

  it('accumulates burst reads in-memory using max-merge', () => {
    vi.useFakeTimers();
    try {
      setRoomReadAt(SESSION, 'r1', 100);
      setRoomReadAt(SESSION, 'r2', 200);
      setRoomReadAt(SESSION, 'r1', 150); // max(100, 150) = 150
      expect(getRoomReadAt('r1')).toBe(150);
      expect(getRoomReadAt('r2')).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushReadsNow resolves without throwing', async () => {
    setRoomReadAt(SESSION, 'r1', 100);
    await expect(flushReadsNow()).resolves.toBeUndefined();
  });

  it('notifies subscribers when a mark advances (drives the unread reconcile)', () => {
    const seen: number[] = [];
    const unsub = subscribeReads(() => seen.push(getRoomReadAt('r1')));
    setRoomReadAt(SESSION, 'r1', 300);
    unsub();
    expect(seen).toEqual([300]);
  });
});
