/**
 * Unit tests for batchFoldSpaceRooms — the batch-pull sibling of foldRoomCached used
 * by the cross-room sweeps (forEachSpaceRoom, loadSpaceStats) to collapse a whole
 * space's room-log pulls into as few `/batch/pull` round-trips as possible.
 *
 * Mocking strategy (mirrors stream-log.cached.test.ts):
 *  - kv: in-memory Map injected via configureKv (real loadStreamLog/kvSet run against it).
 *  - getSpaceClient (starfish-spaces) + buildNodeAccessShared (node-access-cache):
 *    mocked so we control per-room access/encryptor without a real Starfish server.
 *  - AppendLogCursor: mocked (only exercised by the invite-plaintext fallback path,
 *    which still folds via foldRoomCached).
 *  - client.batchPull: a plain vi.fn() on the fake space client — this IS the boundary
 *    under test, so its call args/count are asserted directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureKv } from '../config/adapters';

// ── AppendLogCursor mock (invite-plaintext fallback path only) ──────────────────────
const cursorCalls: Record<string, unknown>[] = [];
let mockPullResult: unknown[] = [];
let mockItems: unknown[] = [];
let mockDecrypted: unknown[] = [];

vi.mock('@drakkar.software/starfish-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/starfish-client')>();
  class FakeAppendLogCursor {
    constructor(opts: Record<string, unknown>) {
      cursorCalls.push(opts);
    }
    async pull() { return mockPullResult; }
    getItems() { return mockItems; }
    async getDecryptedItems() { return mockDecrypted; }
  }
  return { ...actual, AppendLogCursor: FakeAppendLogCursor };
});

const mockGetSpaceClient = vi.fn();
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: (...args: unknown[]) => mockGetSpaceClient(...args) };
});

const mockBuildNodeAccessShared = vi.fn();
vi.mock('../starfish/node-access-cache', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), buildNodeAccessShared: (...args: unknown[]) => mockBuildNodeAccessShared(...args) };
});

import { batchFoldSpaceRooms, resetFoldRoomCache, streamLogKey } from './stream-log';
import { StarfishHttpError } from '@drakkar.software/starfish-client';
import type { Room } from '../domain/types';

const mem = new Map<string, string>();
configureKv({
  get: async (k) => mem.get(k) ?? null,
  set: async (k, v) => { mem.set(k, v); },
  remove: async (k) => { mem.delete(k); },
});

const SESSION = { userId: 'u1' } as never;
const SPACE = 'sp-abc';
const identityEncryptor = { decrypt: async (d: unknown) => d } as never;

const room = (id: string, opts: Partial<Room> = {}): Room =>
  ({ id, spaceId: SPACE, kind: 'channel', category: 'general', name: id, ...opts }) as Room;

const envelope = (id: string, ts: number) => ({ ts, data: { t: 'msg', e: { id, authorId: 'peer', ts } } });

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
  mockGetSpaceClient.mockReset();
  mockBuildNodeAccessShared.mockReset();
  // Default: enc:true rooms get the identity encryptor; plaintext rooms get null
  // (mirrors buildNodeAccessShared's real "enc:false → not cached, no keyring pull").
  mockBuildNodeAccessShared.mockImplementation(async (_s: unknown, _sp: unknown, _id: unknown, node: { enc?: boolean }) =>
    node.enc ? { client: {}, encryptor: identityEncryptor } : null,
  );
});

describe('batchFoldSpaceRooms — batching', () => {
  it('collapses a private + a public room into ONE client.batchPull call', async () => {
    const batchPull = vi.fn().mockResolvedValue({
      collections: {
        objlog: [{ data: { items: [envelope('m1', 10)] } }],
        objpublog: [{ data: { items: [envelope('m2', 20)] } }],
      },
    });
    mockGetSpaceClient.mockReturnValue({ batchPull });

    const rooms = [room('r-priv', { enc: true }), room('r-pub', { access: 'public', enc: false })];
    const result = await batchFoldSpaceRooms(SESSION, SPACE, rooms);

    expect(batchPull).toHaveBeenCalledTimes(1);
    const [collections, opts] = batchPull.mock.calls[0]!;
    expect(collections).toEqual(expect.arrayContaining(['objlog', 'objpublog']));
    expect(opts.params.objlog).toEqual([{ spaceId: SPACE, roomId: 'r-priv' }]);
    expect(opts.params.objpublog).toEqual([{ spaceId: SPACE, roomId: 'r-pub' }]);
    // Cold start (no persisted kv): since:0 for both rooms.
    expect(opts.appendParams.objlog[0]).toMatchObject({ since: 0, appendField: 'items' });
    expect(opts.appendParams.objpublog[0]).toMatchObject({ since: 0, appendField: 'items' });

    expect(result.get('r-priv')?.data.messages.map((m) => m.id)).toEqual(['m1']);
    expect(result.get('r-pub')?.data.messages.map((m) => m.id)).toEqual(['m2']);
  });

  it('derives since: from the persisted kv checkpoint, not a full re-fetch', async () => {
    seedKv(SESSION.userId, 'r-priv', [envelope('old', 5)]);
    const batchPull = vi.fn().mockResolvedValue({ collections: { objlog: [{ data: { items: [envelope('new', 15)] } }] } });
    mockGetSpaceClient.mockReturnValue({ batchPull });

    const result = await batchFoldSpaceRooms(SESSION, SPACE, [room('r-priv', { enc: true })]);

    const [, opts] = batchPull.mock.calls[0]!;
    expect(opts.appendParams.objlog[0].since).toBe(5);
    // Merged: prior + new, both surfaced.
    expect(result.get('r-priv')?.data.messages.map((m) => m.id).sort()).toEqual(['new', 'old']);
  });

  it('persists the merged raw items back to kv (ciphertext-persist parity with foldRoomCached)', async () => {
    const batchPull = vi.fn().mockResolvedValue({ collections: { objlog: [{ data: { items: [envelope('m1', 10)] } }] } });
    mockGetSpaceClient.mockReturnValue({ batchPull });

    await batchFoldSpaceRooms(SESSION, SPACE, [room('r-priv', { enc: true })]);

    const stored = JSON.parse(mem.get(streamLogKey(SESSION.userId, 'r-priv')) ?? '[]') as unknown[];
    expect(stored).toHaveLength(1);
  });
});

describe('batchFoldSpaceRooms — invite-plaintext exclusion', () => {
  it('folds an invite+plaintext room via foldRoomCached, NOT the batch call', async () => {
    const batchPull = vi.fn().mockResolvedValue({ collections: {} });
    mockGetSpaceClient.mockReturnValue({ batchPull });
    mockItems = [envelope('inv1', 1)];
    mockDecrypted = mockItems;

    const result = await batchFoldSpaceRooms(SESSION, SPACE, [room('r-inv', { access: 'invite', enc: false })]);

    expect(batchPull).not.toHaveBeenCalled();
    expect(cursorCalls).toHaveLength(1);
    expect(result.get('r-inv')?.data.messages.map((m) => m.id)).toEqual(['inv1']);
  });
});

describe('batchFoldSpaceRooms — error handling', () => {
  it('rethrows on a 429 without falling back (does not amplify load)', async () => {
    const batchPull = vi.fn().mockRejectedValue(new StarfishHttpError(429, 'rate limited'));
    mockGetSpaceClient.mockReturnValue({ batchPull });

    await expect(batchFoldSpaceRooms(SESSION, SPACE, [room('r-priv', { enc: true })])).rejects.toBeInstanceOf(StarfishHttpError);
  });

  it('degrades to per-room foldRoomCached on a non-429 batch failure', async () => {
    const batchPull = vi.fn().mockRejectedValue(new Error('network'));
    mockGetSpaceClient.mockReturnValue({ batchPull });
    mockItems = [envelope('fallback1', 1)];
    mockDecrypted = mockItems;

    const result = await batchFoldSpaceRooms(SESSION, SPACE, [room('r-priv', { enc: true }), room('r-pub', { access: 'public', enc: false })]);

    expect(cursorCalls).toHaveLength(2); // one per-room fallback fold each
    expect(result.get('r-priv')?.data.messages.map((m) => m.id)).toEqual(['fallback1']);
    expect(result.get('r-pub')?.data.messages.map((m) => m.id)).toEqual(['fallback1']);
  });

  it('a single room with a per-entry batch error falls back to foldRoomCached; the other room keeps its batch result', async () => {
    const batchPull = vi.fn().mockResolvedValue({
      collections: { objlog: [{ data: { items: [envelope('ok', 1)] } }, { error: 'bad_doc' }] },
    });
    mockGetSpaceClient.mockReturnValue({ batchPull });
    mockItems = [envelope('fallback', 1)];
    mockDecrypted = mockItems;

    const result = await batchFoldSpaceRooms(SESSION, SPACE, [room('r-ok', { enc: true }), room('r-bad', { enc: true })]);

    expect(result.get('r-ok')?.data.messages.map((m) => m.id)).toEqual(['ok']);
    expect(result.get('r-bad')?.data.messages.map((m) => m.id)).toEqual(['fallback']);
    expect(cursorCalls).toHaveLength(1); // only the bad room fell back
  });
});

describe('batchFoldSpaceRooms — per-space in-flight coalescing', () => {
  it('two concurrent calls for the same space+rooms share ONE batch call', async () => {
    const batchPull = vi.fn().mockResolvedValue({ collections: { objlog: [{ data: { items: [envelope('m1', 1)] } }] } });
    mockGetSpaceClient.mockReturnValue({ batchPull });

    const rooms = [room('r-priv', { enc: true })];
    const [r1, r2] = await Promise.all([
      batchFoldSpaceRooms(SESSION, SPACE, rooms),
      batchFoldSpaceRooms(SESSION, SPACE, rooms),
    ]);

    expect(batchPull).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });
});
