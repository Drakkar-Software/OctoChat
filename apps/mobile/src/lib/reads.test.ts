import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadPrefs } from '@/lib/types';

// In-memory kv so hydrate/persist round-trips without the expo runtime.
const store = new Map<string, string>();
vi.mock('./starfish/kv', () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
}));

// Capture the synced write so we can assert coalescing + run the max-merge mutator.
const updateReadsDoc = vi.fn(async (_client: unknown, _userId: string, _mutator: (c: ReadPrefs) => ReadPrefs | null) => {});
vi.mock('./starfish/registry', () => ({
  updateReadsDoc: (...args: [unknown, string, (c: ReadPrefs) => ReadPrefs | null]) => updateReadsDoc(...args),
}));

import {
  flushReadsNow,
  getRoomReadAt,
  hydrateReads,
  loadReadMarksFromKv,
  resetReads,
  setRoomReadAt,
  subscribeReads,
} from './reads';

const SESSION = { userId: 'u', accountClient: {} } as never;

beforeEach(() => {
  store.clear();
  updateReadsDoc.mockClear();
  resetReads();
});

describe('hydrateReads', () => {
  it('max-merges the server copy with kv and the legacy lastread map (highest wins)', async () => {
    store.set('octochat.reads.u', JSON.stringify({ rooms: { r1: 100, r2: 50 } }));
    store.set('octochat.lastread.u', JSON.stringify({ r2: 80, r3: 10 })); // legacy = bare map
    await hydrateReads('u', { rooms: { r1: 90, r4: 5 } });
    expect(getRoomReadAt('r1')).toBe(100); // kv 100 beats server 90
    expect(getRoomReadAt('r2')).toBe(80); // legacy 80 beats kv 50
    expect(getRoomReadAt('r3')).toBe(10);
    expect(getRoomReadAt('r4')).toBe(5);
  });

  it('does not roll back an un-flushed in-memory mark on a stale server read', async () => {
    setRoomReadAt(SESSION, 'r1', 500); // optimistic local mark, not yet flushed
    await hydrateReads('u', { rooms: { r1: 100 } }); // server still behind
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

  it('coalesces a burst of reads into ONE synced push, max-merged onto server state', async () => {
    vi.useFakeTimers();
    try {
      setRoomReadAt(SESSION, 'r1', 100);
      setRoomReadAt(SESSION, 'r2', 200);
      setRoomReadAt(SESSION, 'r1', 150);
      expect(updateReadsDoc).not.toHaveBeenCalled(); // still within the debounce window
      await vi.advanceTimersByTimeAsync(8_000);
      expect(updateReadsDoc).toHaveBeenCalledTimes(1);
      // The mutator max-merges the whole local cache onto fresh server state...
      const mutator = updateReadsDoc.mock.calls[0][2];
      expect(mutator({ rooms: { r2: 50 } })).toEqual({ rooms: { r1: 150, r2: 200 } });
      // ...and no-ops when the server already has everything.
      expect(mutator({ rooms: { r1: 150, r2: 200 } })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushReadsNow pushes without waiting for the debounce', async () => {
    setRoomReadAt(SESSION, 'r1', 100);
    await flushReadsNow();
    expect(updateReadsDoc).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when a mark advances (drives the unread reconcile)', () => {
    const seen: number[] = [];
    const unsub = subscribeReads(() => seen.push(getRoomReadAt('r1')));
    setRoomReadAt(SESSION, 'r1', 300);
    unsub();
    expect(seen).toEqual([300]);
  });
});
