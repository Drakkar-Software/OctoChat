/**
 * Unit tests for foldRoomCached — the warm-start aware room-fold helper for
 * cross-room sweeps (threads, pins, search, stats, digest).
 *
 * Mocking strategy (mirrors dm-activity.test.ts):
 *  - kv: in-memory Map injected via configureKv.
 *  - AppendLogCursor: mocked at the module level via vi.mock so we control
 *    pull() / getItems() / getDecryptedItems() without a real Starfish server.
 *  - loadStreamLog: the real implementation runs (it reads from the in-memory kv).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureKv } from '../config/adapters';
import { streamLogKey } from './stream-log';

// ── AppendLogCursor mock ──────────────────────────────────────────────────────────
// We need full control over what the cursor returns, including whether it fires
// a full vs incremental pull. The mock tracks `cursorCalls` so tests can assert
// the constructor options (esp. `initialItems`, which drives the checkpoint decision)
// and how many cursors were built.

interface CursorCall {
  opts: Record<string, unknown>;
  initialItems: unknown[];
}

const cursorCalls: CursorCall[] = [];
let mockPullResult: unknown[] = [];
let mockItems: unknown[] = [];
let mockDecrypted: unknown[] = [];

vi.mock('@drakkar.software/starfish-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/starfish-client')>();
  class FakeAppendLogCursor {
    private _initial: unknown[];
    constructor(opts: Record<string, unknown>) {
      this._initial = (opts['initialItems'] as unknown[]) ?? [];
      cursorCalls.push({ opts, initialItems: this._initial });
    }
    async pull() { return mockPullResult; }
    getItems() { return mockItems; }
    async getDecryptedItems() { return mockDecrypted; }
  }
  return { ...actual, AppendLogCursor: FakeAppendLogCursor };
});

import { foldRoomCached, resetFoldRoomCache } from './stream-log';

// ── In-memory kv ──────────────────────────────────────────────────────────────────

const mem = new Map<string, string>();
configureKv({
  get: async (k) => mem.get(k) ?? null,
  set: async (k, v) => { mem.set(k, v); },
  remove: async (k) => { mem.delete(k); },
});

const USER = 'u-test';
const ROOM = 'sp-room-test';
const PULL_PATH = `spaces/sp-test/objects/logs/${ROOM}`;
const fakeClient = {} as import('@drakkar.software/starfish-client').StarfishClient;

function seedKv(userId: string, roomId: string, items: unknown[]) {
  mem.set(streamLogKey(userId, roomId), JSON.stringify(items));
}

beforeEach(() => {
  mem.clear();
  resetFoldRoomCache();
  cursorCalls.length = 0;
  mockPullResult = [];
  mockItems = [];
  mockDecrypted = [];
});

// ── Cold start ────────────────────────────────────────────────────────────────────

describe('foldRoomCached — cold start (no kv blob)', () => {
  it('builds cursor with empty initialItems when kv has no blob', async () => {
    mockDecrypted = [];
    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(cursorCalls).toHaveLength(1);
    expect(cursorCalls[0]!.initialItems).toHaveLength(0);
  });

  it('returns an empty FoldedLog on a cold empty room', async () => {
    mockItems = [];
    mockDecrypted = [];
    const { data, items } = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(items).toHaveLength(0);
    expect(data.messages).toHaveLength(0);
  });

  it('writes a kv checkpoint even for empty rooms', async () => {
    mockItems = [];
    mockDecrypted = [];
    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    const blob = mem.get(streamLogKey(USER, ROOM));
    expect(blob).toBeDefined();
    expect(JSON.parse(blob!)).toEqual([]);
  });
});

// ── Warm start ────────────────────────────────────────────────────────────────────

describe('foldRoomCached — warm start (kv blob present)', () => {
  it('builds cursor with the persisted initialItems', async () => {
    const prior = [{ ts: 1000, data: { t: 'msg', e: { id: 'm1', authorId: 'u1', ts: 1000 } } }];
    seedKv(USER, ROOM, prior);
    mockItems = prior;
    mockDecrypted = prior;

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);

    expect(cursorCalls[0]!.initialItems).toHaveLength(1);
    expect((cursorCalls[0]!.initialItems as typeof prior)[0]!.ts).toBe(1000);
  });

  it('returns the warm-start data (fanOut of decryptedItems)', async () => {
    const items = [{ ts: 1, data: { t: 'msg', e: { id: 'm1', authorId: 'u1', ts: 1, text: 'hi' } } }];
    seedKv(USER, ROOM, items);
    mockItems = items;
    mockDecrypted = items;

    const { data } = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(data.messages.map((m) => m.id)).toContain('m1');
  });
});

// ── Persist-back ──────────────────────────────────────────────────────────────────

describe('foldRoomCached — persist-back', () => {
  it('writes to kv when cursor grew (new items from pull)', async () => {
    const prior = [{ ts: 100, data: {} }];
    seedKv(USER, ROOM, prior);
    mockItems = [...prior, { ts: 200, data: {} }]; // grew by 1
    mockDecrypted = mockItems;

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);

    const stored = JSON.parse(mem.get(streamLogKey(USER, ROOM)) ?? '[]') as unknown[];
    expect(stored).toHaveLength(2);
  });

  it('writes to kv even when item count is unchanged (always fresh checkpoint)', async () => {
    const prior = [{ ts: 100, data: {} }];
    seedKv(USER, ROOM, prior);
    mockItems = prior; // same length — no growth
    mockDecrypted = prior;

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);

    const stored = JSON.parse(mem.get(streamLogKey(USER, ROOM)) ?? '[]') as unknown[];
    expect(stored).toHaveLength(prior.length);
  });
});

// ── Fresh on sequential calls (no TTL) ───────────────────────────────────────────

describe('foldRoomCached — freshness (no TTL, sequential calls build new cursors)', () => {
  it('builds a new cursor on a second non-concurrent call (always fresh)', async () => {
    mockItems = [];
    mockDecrypted = [];

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(cursorCalls).toHaveLength(1);

    // Second sequential call — NOT concurrent — should build a fresh cursor.
    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(cursorCalls).toHaveLength(2);
  });

  it('builds a new cursor after resetFoldRoomCache clears in-flight map', async () => {
    mockItems = [];
    mockDecrypted = [];

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    resetFoldRoomCache();
    cursorCalls.length = 0;

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(cursorCalls).toHaveLength(1);
  });
});

// ── Coalescing ────────────────────────────────────────────────────────────────────

describe('foldRoomCached — in-flight coalescing', () => {
  it('two concurrent calls for the same room resolve to the same object', async () => {
    mockItems = [];
    mockDecrypted = [];

    const coalesceRoom = ROOM + '-coalesce';
    resetFoldRoomCache();
    const p1 = foldRoomCached(USER, fakeClient, null, coalesceRoom, PULL_PATH);
    const p2 = foldRoomCached(USER, fakeClient, null, coalesceRoom, PULL_PATH);

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both resolve to the SAME object (in-flight coalescing, not two independent folds).
    expect(r1).toBe(r2);
    // Only one cursor built despite two calls.
    expect(cursorCalls).toHaveLength(1);
  });

  it('after concurrent fold resolves, a third non-concurrent call builds a fresh cursor', async () => {
    mockItems = [];
    mockDecrypted = [];

    const coalesceRoom2 = ROOM + '-coalesce2';
    resetFoldRoomCache();

    // Two concurrent calls share one fold.
    await Promise.all([
      foldRoomCached(USER, fakeClient, null, coalesceRoom2, PULL_PATH),
      foldRoomCached(USER, fakeClient, null, coalesceRoom2, PULL_PATH),
    ]);
    expect(cursorCalls).toHaveLength(1);

    // Third call after the in-flight has resolved — must build a fresh cursor.
    cursorCalls.length = 0;
    await foldRoomCached(USER, fakeClient, null, coalesceRoom2, PULL_PATH);
    expect(cursorCalls).toHaveLength(1);
  });
});

// ── pullPath isolation (Fix B) ────────────────────────────────────────────────────

describe('foldRoomCached — pullPath isolation', () => {
  it('concurrent calls with different pullPaths build separate cursors (not coalesced)', async () => {
    mockItems = [];
    mockDecrypted = [];

    const pathA = `spaces/sp-test/objects/logs/${ROOM}`;
    const pathB = `spaces/sp-test/objects/invlogs/${ROOM}`;

    const [r1, r2] = await Promise.all([
      foldRoomCached(USER, fakeClient, null, ROOM, pathA),
      foldRoomCached(USER, fakeClient, null, ROOM, pathB),
    ]);

    // Two different paths → two independent cursors, two independent results.
    expect(cursorCalls).toHaveLength(2);
    // They should NOT be the same object (different in-flight keys).
    expect(r1).not.toBe(r2);
  });

  it('concurrent calls with the same pullPath coalesce into one cursor', async () => {
    mockItems = [];
    mockDecrypted = [];

    await Promise.all([
      foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH),
      foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH),
    ]);
    expect(cursorCalls).toHaveLength(1);
  });
});

// ── Enc vs plaintext cache separation ─────────────────────────────────────────────

describe('foldRoomCached — enc/plaintext cache key separation', () => {
  it('enc and plaintext results for the same room are cached under different keys', async () => {
    mockItems = [];
    mockDecrypted = [];

    // First fold: plaintext (enc = null)
    const plain = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    cursorCalls.length = 0;

    // Second fold: "enc" (pass a mock encryptor object)
    const fakeEnc = {} as import('@drakkar.software/starfish-client').Encryptor;
    const enc = await foldRoomCached(USER, fakeClient, fakeEnc, ROOM, PULL_PATH);

    // Both should have succeeded; they are separate results (separate keys, not coalesced).
    expect(plain).toBeDefined();
    expect(enc).toBeDefined();
    expect(cursorCalls).toHaveLength(1);
    expect(cursorCalls[0]!.opts['encryptor']).toBe(fakeEnc);
    expect(cursorCalls[0]!.opts['persistEncrypted']).toBe(true);
  });
});

// ── Cross-account isolation (mirrors stream-log.test.ts pattern) ──────────────────

describe('foldRoomCached — cross-account isolation', () => {
  it('user B does not receive user A warm-start blob', async () => {
    seedKv('uA', ROOM, [{ ts: 999, data: {} }]);
    mockItems = [];
    mockDecrypted = [];

    await foldRoomCached('uB', fakeClient, null, ROOM, PULL_PATH);

    // uB's cursor must have been built with empty initialItems (no uA blob).
    expect(cursorCalls[0]!.initialItems).toHaveLength(0);
  });
});
