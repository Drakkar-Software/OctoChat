import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for loadSpaceStats. All rooms now live in a plaintext object index;
 * access/enc per node (not per space). Mocks cover the external boundaries:
 * 1. getSpaceClient (starfish-spaces) — auth
 * 2. listSpaceRooms (cross-room) — coalesced room list from the object index
 * 3. batchFoldSpaceRooms (stream-log) — batch-pull + fold for the whole space's rooms
 * resolveEdit and buildThreadDigest have their own suites; stubs isolate stats arithmetic.
 * batchFoldSpaceRooms itself has its own suite (stream-log.batch.test.ts) — these tests
 * only cover how loadSpaceStats consumes its Map<roomId, FoldedLog> result.
 */
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: vi.fn(() => ({})) };
});
// listSpaceRooms is now the room-list boundary (replaces readIndexRooms).
vi.mock('../messaging/cross-room', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), listSpaceRooms: vi.fn() };
});
// batchFoldSpaceRooms is the batch-fold boundary (replaces the per-room foldRoomCached loop).
vi.mock('../messaging/stream-log', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), batchFoldSpaceRooms: vi.fn() };
});
vi.mock('../format/message-view', () => ({ resolveEdit: vi.fn() }));
vi.mock('../messaging/threads', () => ({ buildThreadDigest: vi.fn(() => []) }));

import { loadSpaceStats } from './space-stats';
import { getSpaceClient } from '@drakkar.software/starfish-spaces';
import { listSpaceRooms } from '../messaging/cross-room';
import { batchFoldSpaceRooms, type FoldedLog } from '../messaging/stream-log';
import { resolveEdit } from '../format/message-view';
import { buildThreadDigest } from '../messaging/threads';
import type { StoredMsg } from '../format/message-view';
import type { Room } from '../domain/types';

const mockGetSpaceClient = vi.mocked(getSpaceClient);
const mockListSpaceRooms = vi.mocked(listSpaceRooms);
const mockBatchFoldSpaceRooms = vi.mocked(batchFoldSpaceRooms);
const mockResolveEdit = vi.mocked(resolveEdit);
const mockBuildThreadDigest = vi.mocked(buildThreadDigest);

const SESSION = { userId: 'self' } as never;
const SPACE = 'sp-abc';
const FAKE_CLIENT = {} as never;

const room = (id: string, opts: Partial<Room> = {}): Room =>
  ({ id, spaceId: SPACE, kind: 'channel', ...opts }) as Room;
const msg = (id: string, over: Partial<StoredMsg> = {}): StoredMsg =>
  ({ id, authorId: 'u1', ts: 1, ...over }) as StoredMsg;

function foldedLog(messages: StoredMsg[], items: unknown[] = [], failed?: boolean): FoldedLog {
  return { data: { messages, edits: [], reactions: [], pins: [] }, items, ...(failed ? { failed } : {}) } as FoldedLog;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSpaceClient.mockReturnValue(FAKE_CLIENT);
  mockResolveEdit.mockReturnValue(undefined);
  mockBuildThreadDigest.mockReturnValue([]);
});

describe('loadSpaceStats — plaintext (enc: false) rooms', () => {
  it('sums bytes + counts messages and attachments correctly', async () => {
    const items = [{ ts: 1 }, { ts: 2 }, { ts: 3 }]; // 3 raw elements
    const messages = [
      msg('m1'),
      msg('m2', { attachment: { size: 500 } as never }), // deleted — attachment still counted
      msg('m3', { attachment: { size: 1000 } as never }),
    ];
    mockResolveEdit.mockImplementation((_e, id) =>
      id === 'm2' ? ({ kind: 'delete' } as never) : undefined,
    );
    mockBuildThreadDigest.mockReturnValue([{} as never]); // 1 thread
    mockListSpaceRooms.mockResolvedValue([room('r1')]);
    mockBatchFoldSpaceRooms.mockResolvedValue(new Map([['r1', foldedLog(messages, items)]]));

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({
      rooms: 1,
      messages: 2, // m2 folded out (delete)
      threads: 1,
      attachments: 2, // m2 + m3 — deleted attachment still occupies space
      bytes: JSON.stringify(items).length + 500 + 1000,
      partial: false,
    });
  });

  it('treats an empty room (no log yet) as zero, not an error', async () => {
    mockListSpaceRooms.mockResolvedValue([room('r1')]);
    mockBatchFoldSpaceRooms.mockResolvedValue(new Map([['r1', foldedLog([], [])]]));

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toMatchObject({ rooms: 1, messages: 0, attachments: 0, bytes: 0, partial: false });
  });
});

describe('loadSpaceStats — multiple rooms', () => {
  it('accumulates across every room the batch returns', async () => {
    mockListSpaceRooms.mockResolvedValue([room('r1'), room('r2', { access: 'public', enc: false })]);
    mockBatchFoldSpaceRooms.mockResolvedValue(
      new Map([
        ['r1', foldedLog([msg('m1')], [{}])],
        ['r2', foldedLog([msg('m2')], [{}])],
      ]),
    );

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.rooms).toBe(2);
    expect(stats.messages).toBe(2);
    expect(stats.partial).toBe(false);
  });
});

describe('loadSpaceStats — failure handling', () => {
  it('sets partial and skips a room the batch marks failed, keeping other rooms', async () => {
    mockListSpaceRooms.mockResolvedValue([room('good'), room('bad')]);
    mockBatchFoldSpaceRooms.mockResolvedValue(
      new Map([
        ['good', foldedLog([msg('m1')], [{}])],
        ['bad', foldedLog([], [], true)],
      ]),
    );

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.partial).toBe(true);
    expect(stats.rooms).toBe(2);
    expect(stats.messages).toBe(1); // good room counted
  });

  it('sets partial when the batch omits a room entirely from its result Map', async () => {
    mockListSpaceRooms.mockResolvedValue([room('good'), room('missing')]);
    mockBatchFoldSpaceRooms.mockResolvedValue(new Map([['good', foldedLog([msg('m1')], [{}])]]));

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.partial).toBe(true);
    expect(stats.messages).toBe(1);
  });

  it('returns partial snapshot when room list is unreadable', async () => {
    mockListSpaceRooms.mockRejectedValue(new Error('network'));

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({ rooms: 0, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: true });
  });

  it('returns partial snapshot when the whole batch call throws (e.g. 429)', async () => {
    mockListSpaceRooms.mockResolvedValue([room('r1')]);
    mockBatchFoldSpaceRooms.mockRejectedValue(new Error('rate limited'));

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({ rooms: 1, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: true });
  });
});
