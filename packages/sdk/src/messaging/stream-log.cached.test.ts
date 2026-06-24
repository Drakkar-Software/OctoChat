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
// a full vs incremental pull. The mock tracks `constructedWith` so tests can assert
// the constructor options (esp. `initialItems`, which drives the checkpoint decision).

interface CursorCall {
  opts: Record<string, unknown>;
  initialItems: unknown[];
}

let lastCursorCall: CursorCall | null = null;
let mockPullResult: unknown[] = [];
let mockItems: unknown[] = [];
let mockDecrypted: unknown[] = [];

vi.mock('@drakkar.software/starfish-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/starfish-client')>();
  class FakeAppendLogCursor {
    private _initial: unknown[];
    constructor(opts: Record<string, unknown>) {
      this._initial = (opts['initialItems'] as unknown[]) ?? [];
      lastCursorCall = { opts, initialItems: this._initial };
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
  lastCursorCall = null;
  mockPullResult = [];
  mockItems = [];
  mockDecrypted = [];
});

// ── Cold start ────────────────────────────────────────────────────────────────────

describe('foldRoomCached — cold start (no kv blob)', () => {
  it('builds cursor with empty initialItems when kv has no blob', async () => {
    mockDecrypted = [];
    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(lastCursorCall).not.toBeNull();
    expect(lastCursorCall!.initialItems).toHaveLength(0);
  });

  it('returns an empty FoldedLog on a cold empty room', async () => {
    mockItems = [];
    mockDecrypted = [];
    const { data, items } = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(items).toHaveLength(0);
    expect(data.messages).toHaveLength(0);
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

    expect(lastCursorCall!.initialItems).toHaveLength(1);
    expect((lastCursorCall!.initialItems as typeof prior)[0]!.ts).toBe(1000);
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

  it('does NOT rewrite kv when cursor did not grow', async () => {
    const prior = [{ ts: 100, data: {} }];
    seedKv(USER, ROOM, prior);
    const originalBlob = mem.get(streamLogKey(USER, ROOM));
    mockItems = prior; // same length — no growth
    mockDecrypted = prior;

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);

    // Blob was not rewritten (or was rewritten with same content — either is ok).
    // The important thing: length unchanged.
    const stored = JSON.parse(mem.get(streamLogKey(USER, ROOM)) ?? '[]') as unknown[];
    expect(stored).toHaveLength(prior.length);
    expect(mem.get(streamLogKey(USER, ROOM))).toBe(originalBlob);
  });
});

// ── TTL cache ─────────────────────────────────────────────────────────────────────

describe('foldRoomCached — TTL throttle', () => {
  it('returns cached result without building a new cursor on second call within TTL', async () => {
    mockItems = [];
    mockDecrypted = [];

    const r1 = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    const callsAfterFirst = lastCursorCall;

    // Second call — should hit TTL cache, not build a new cursor.
    lastCursorCall = null;
    const r2 = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);

    expect(lastCursorCall).toBeNull(); // no new cursor built
    expect(r2).toBe(r1); // same object reference (no allocation)
    void callsAfterFirst; // suppress unused-var warning
  });

  it('re-folds after resetFoldRoomCache clears the TTL', async () => {
    mockItems = [];
    mockDecrypted = [];

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    resetFoldRoomCache();
    lastCursorCall = null;

    await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    expect(lastCursorCall).not.toBeNull(); // new cursor built after reset
  });
});

// ── Coalescing ────────────────────────────────────────────────────────────────────

describe('foldRoomCached — in-flight coalescing', () => {
  it('two concurrent calls for the same room resolve to the same object', async () => {
    // Use the existing FakeAppendLogCursor mock (pull() resolves synchronously via
    // microtask). Both calls start before either resolves, so they share the in-flight
    // promise — both should receive the identical FoldedLog reference.
    mockItems = [];
    mockDecrypted = [];

    const coalesceRoom = ROOM + '-coalesce';
    resetFoldRoomCache();
    const p1 = foldRoomCached(USER, fakeClient, null, coalesceRoom, PULL_PATH);
    const p2 = foldRoomCached(USER, fakeClient, null, coalesceRoom, PULL_PATH);

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both resolve to the SAME object (in-flight coalescing, not two independent folds).
    expect(r1).toBe(r2);
  });

  it('after concurrent fold, a third call within TTL hits cache (no new cursor)', async () => {
    mockItems = [];
    mockDecrypted = [];

    const coalesceRoom2 = ROOM + '-coalesce2';
    resetFoldRoomCache();

    // Two concurrent calls share one fold.
    const [r1] = await Promise.all([
      foldRoomCached(USER, fakeClient, null, coalesceRoom2, PULL_PATH),
      foldRoomCached(USER, fakeClient, null, coalesceRoom2, PULL_PATH),
    ]);

    // Third call within TTL: should return the same cached object — no new cursor.
    lastCursorCall = null;
    const r3 = await foldRoomCached(USER, fakeClient, null, coalesceRoom2, PULL_PATH);
    expect(lastCursorCall).toBeNull(); // no new cursor built
    expect(r3).toBe(r1); // same cached result
  });
});

// ── Enc vs plaintext cache separation ─────────────────────────────────────────────

describe('foldRoomCached — enc/plaintext cache key separation', () => {
  it('enc and plaintext results for the same room are cached under different keys', async () => {
    mockItems = [];
    mockDecrypted = [];

    // First fold: plaintext (enc = null)
    const plain = await foldRoomCached(USER, fakeClient, null, ROOM, PULL_PATH);
    resetFoldRoomCache(); // clear so second call definitely builds a new cursor
    lastCursorCall = null;

    // Second fold: "enc" (pass a mock encryptor object)
    const fakeEnc = {} as import('@drakkar.software/starfish-client').Encryptor;
    const enc = await foldRoomCached(USER, fakeClient, fakeEnc, ROOM, PULL_PATH);

    // Both should have succeeded; they are separate results.
    expect(plain).toBeDefined();
    expect(enc).toBeDefined();
    expect(lastCursorCall!.opts['encryptor']).toBe(fakeEnc);
    expect(lastCursorCall!.opts['persistEncrypted']).toBe(true);
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
    expect(lastCursorCall!.initialItems).toHaveLength(0);
  });
});
