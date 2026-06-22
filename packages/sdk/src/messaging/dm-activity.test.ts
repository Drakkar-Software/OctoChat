/**
 * Unit tests for dm-activity.ts — the authoritative DM head-timestamp store.
 *
 * We mock `getSpaceClient` (the network step — returns an auth'd client) and
 * `loadStreamLog` (the local streamlog cache step) so the tests run without a real
 * Starfish server or kv blobs. kv is in-memory via `configureKv`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureKv } from '../config/adapters';
import { makeMockSession } from '../test-utils/mock-session';

// ── Mocks (must come before the module import) ──────────────────────────────────

const mockLoadStreamLog = vi.fn(async (_userId: string, _roomId: string) => []);
vi.mock('./stream-log', () => ({
  loadStreamLog: (...args: unknown[]) => mockLoadStreamLog(...args),
}));

type FakePull = (path: string, opts: Record<string, unknown>) => Promise<unknown[]>;
let fakePull: FakePull = async () => [];
const mockGetSpaceClient = vi.fn(() => ({
  pull: (...args: Parameters<FakePull>) => fakePull(...args),
}));
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: (...args: unknown[]) => mockGetSpaceClient(...args) };
});

import {
  getDmHeads,
  loadDmHeadsFromKv,
  refreshDmHeads,
  resetDmHeads,
  subscribeDmHeads,
} from './dm-activity';

// ── In-memory kv ────────────────────────────────────────────────────────────────

const mem = new Map<string, string>();
configureKv({
  get: async (k) => mem.get(k) ?? null,
  set: async (k, v) => { mem.set(k, v); },
  remove: async (k) => { mem.delete(k); },
});

const SESSION = makeMockSession({ userId: 'u1' });
const DM_SPACE = 'dm-aabbccdd';
const DM_ROOM = 'dm-aabbccdd-dm';

// ── Test helpers ─────────────────────────────────────────────────────────────────

function makeItems(ts: number) {
  return [{ ts, data: {} }];
}

beforeEach(() => {
  mem.clear();
  resetDmHeads();
  mockLoadStreamLog.mockReset();
  mockLoadStreamLog.mockResolvedValue([]);
  mockGetSpaceClient.mockReset();
  fakePull = async () => [];
  mockGetSpaceClient.mockImplementation(() => ({
    pull: (...args: Parameters<FakePull>) => fakePull(...args),
  }));
  vi.useRealTimers();
});

// ── loadDmHeadsFromKv ────────────────────────────────────────────────────────────

describe('loadDmHeadsFromKv', () => {
  it('seeds the store from persisted kv', async () => {
    mem.set(`octochat.dmhead.u1`, JSON.stringify({ [DM_ROOM]: 1_000 }));
    await loadDmHeadsFromKv('u1');
    expect(getDmHeads()[DM_ROOM]).toBe(1_000);
  });

  it('tolerates absent key gracefully', async () => {
    await loadDmHeadsFromKv('u1');
    expect(getDmHeads()[DM_ROOM]).toBeUndefined();
  });

  it('tolerates corrupt kv gracefully', async () => {
    mem.set(`octochat.dmhead.u1`, 'not-json{{{');
    await expect(loadDmHeadsFromKv('u1')).resolves.not.toThrow();
  });

  it('max-merges: a higher existing value survives a lower kv value', async () => {
    mem.set(`octochat.dmhead.u1`, JSON.stringify({ [DM_ROOM]: 500 }));
    fakePull = async () => makeItems(2_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    const highTs = getDmHeads()[DM_ROOM];
    expect(highTs).toBe(2_000);
    await loadDmHeadsFromKv('u1');
    expect(getDmHeads()[DM_ROOM]).toBe(2_000);
  });
});

// ── refreshDmHeads — source 2: local streamlog cache ────────────────────────────

describe('refreshDmHeads — source 2: local streamlog cache', () => {
  it('takes the max ts from the opened-room cache (no network call)', async () => {
    // Make the network step fail so only source 2 fires.
    fakePull = async () => { throw new Error('offline'); };
    mockLoadStreamLog.mockResolvedValue([{ ts: 1_500, data: {} }, { ts: 800, data: {} }]);

    await refreshDmHeads(SESSION, [DM_SPACE]);

    expect(getDmHeads()[DM_ROOM]).toBe(1_500);
    expect(mockLoadStreamLog).toHaveBeenCalledWith(SESSION.userId, DM_ROOM);
  });

  it('ignores a streamlog item with no ts (0 / undefined)', async () => {
    fakePull = async () => { throw new Error('offline'); };
    mockLoadStreamLog.mockResolvedValue([{ ts: 0, data: {} }, { data: {} }]);

    await refreshDmHeads(SESSION, [DM_SPACE]);

    expect(getDmHeads()[DM_ROOM]).toBeUndefined();
  });
});

// ── refreshDmHeads — source 3: authoritative server pull ────────────────────────

describe('refreshDmHeads — source 3: authoritative server head pull', () => {
  it('reads outer ts from last:1 pull, never touching data (no decrypt)', async () => {
    fakePull = async (_path, opts) => {
      expect(opts['last']).toBe(1);
      expect(opts['appendField']).toBe('items');
      return [{ ts: 3_000, data: 'SEALED_BLOB_NEVER_DECRYPTED' }];
    };

    await refreshDmHeads(SESSION, [DM_SPACE]);

    expect(getDmHeads()[DM_ROOM]).toBe(3_000);
  });

  it('a per-DM pull failure does not drop sibling DM heads', async () => {
    const DM_SPACE_2 = 'dm-11223344';
    const DM_ROOM_2 = 'dm-11223344-dm';

    let call = 0;
    fakePull = async (_path) => {
      call++;
      if (call === 1) throw new Error('no cap');
      return makeItems(9_000);
    };

    await refreshDmHeads(SESSION, [DM_SPACE, DM_SPACE_2]);

    const heads = getDmHeads();
    const succeeded = heads[DM_ROOM] === 9_000 || heads[DM_ROOM_2] === 9_000;
    expect(succeeded).toBe(true);
  });

  it('max-merge: a lower server value never rolls back a higher existing head', async () => {
    fakePull = async () => makeItems(5_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    expect(getDmHeads()[DM_ROOM]).toBe(5_000);

    vi.useRealTimers();
    fakePull = async () => makeItems(1_000);
    await refreshDmHeads(SESSION, [DM_SPACE], { force: true });
    expect(getDmHeads()[DM_ROOM]).toBe(5_000);
  });
});

// ── Throttle ─────────────────────────────────────────────────────────────────────

describe('refreshDmHeads throttle', () => {
  it('skips the network step on a too-soon second call', async () => {
    fakePull = async () => makeItems(1_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    const callsAfterFirst = mockGetSpaceClient.mock.calls.length;

    fakePull = async () => makeItems(2_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    expect(mockGetSpaceClient.mock.calls.length).toBe(callsAfterFirst); // no new calls
    expect(getDmHeads()[DM_ROOM]).toBe(1_000);
  });

  it('force:true bypasses the throttle', async () => {
    fakePull = async () => makeItems(1_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);

    fakePull = async () => makeItems(7_000);
    await refreshDmHeads(SESSION, [DM_SPACE], { force: true });
    expect(getDmHeads()[DM_ROOM]).toBe(7_000);
  });
});

// ── Concurrent call coalescing ───────────────────────────────────────────────────

describe('refreshDmHeads concurrency', () => {
  it('coalesces two concurrent calls onto a single in-flight promise', async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => (resolveFirst = r));
    let pullCalls = 0;
    fakePull = async () => {
      pullCalls++;
      await firstDone;
      return makeItems(4_000);
    };

    const p1 = refreshDmHeads(SESSION, [DM_SPACE]);
    const p2 = refreshDmHeads(SESSION, [DM_SPACE]);

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(pullCalls).toBe(1);
    expect(getDmHeads()[DM_ROOM]).toBe(4_000);
  });
});

// ── Subscribe / listeners ────────────────────────────────────────────────────────

describe('subscribeDmHeads', () => {
  it('fires listener when heads advance', async () => {
    fakePull = async () => makeItems(6_000);
    let fired = 0;
    const unsub = subscribeDmHeads(() => { fired++; });

    await refreshDmHeads(SESSION, [DM_SPACE]);
    unsub();

    expect(fired).toBeGreaterThan(0);
  });

  it('does not fire after unsubscribe', async () => {
    let fired = 0;
    const unsub = subscribeDmHeads(() => { fired++; });
    unsub();

    fakePull = async () => makeItems(6_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    expect(fired).toBe(0);
  });
});

// ── resetDmHeads ─────────────────────────────────────────────────────────────────

describe('resetDmHeads', () => {
  it('clears all heads on sign-out', async () => {
    fakePull = async () => makeItems(1_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    expect(getDmHeads()[DM_ROOM]).toBe(1_000);

    resetDmHeads();
    expect(getDmHeads()[DM_ROOM]).toBeUndefined();
  });

  it('allows a fresh refresh after reset (no stale coalesce)', async () => {
    fakePull = async () => makeItems(1_000);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    resetDmHeads();

    fakePull = async () => makeItems(2_500);
    await refreshDmHeads(SESSION, [DM_SPACE]);
    expect(getDmHeads()[DM_ROOM]).toBe(2_500);
  });
});
