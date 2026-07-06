/**
 * Unit tests for the cache-only sweep — loadAllThreadsFromCache / loadAllPinsFromCache
 * — the sidebar's zero-network existence-flag source (see use-space-nav.ts).
 *
 * These must NEVER touch the network for a room's message log: the fake space client's
 * `pull`/`batchPull` are spies that throw if called, so any accidental network hop fails
 * the test loudly instead of silently degrading to "just returns empty".
 *
 * Mocking strategy:
 *  - kv: in-memory Map injected via configureKv (foldRoomFromCache/loadStreamLog run for real).
 *  - readIndexRooms (object-index) + readSpaceAccess (registry): mocked — these ARE real,
 *    cheap, coalesced network reads (room list + owner), unrelated to what's under test.
 *  - peekNodeAccess (node-access-cache): mocked — controls whether an enc room's keyring
 *    is "already resolved this session" without touching the real in-flight/resolved maps.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureKv } from '../config/adapters';

vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: vi.fn(() => fakeClient) };
});
vi.mock('../starfish/object-index', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), readIndexRooms: vi.fn() };
});
vi.mock('../starfish/registry', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), readSpaceAccess: vi.fn() };
});
vi.mock('../starfish/node-access-cache', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), peekNodeAccess: vi.fn() };
});

import {
  loadAllPinsFromCache,
  loadAllThreadsFromCache,
  resetSpaceLevelMetaCache,
} from './cross-room';
import { resetFoldRoomCache, streamLogKey } from './stream-log';
import { readIndexRooms } from '../starfish/object-index';
import { readSpaceAccess } from '../starfish/registry';
import { peekNodeAccess } from '../starfish/node-access-cache';
import type { Room } from '../domain/types';

const mockReadIndexRooms = vi.mocked(readIndexRooms);
const mockReadSpaceAccess = vi.mocked(readSpaceAccess);
const mockPeekNodeAccess = vi.mocked(peekNodeAccess);

const fakeClient = {
  pull: vi.fn(() => { throw new Error('unexpected network pull'); }),
  batchPull: vi.fn(() => { throw new Error('unexpected network batchPull'); }),
};

const mem = new Map<string, string>();
configureKv({
  get: async (k) => mem.get(k) ?? null,
  set: async (k, v) => { mem.set(k, v); },
  remove: async (k) => { mem.delete(k); },
});

const SESSION = { userId: 'u1' } as never;

const room = (id: string, opts: Partial<Room> = {}): Room =>
  ({ id, spaceId: 'sp-x', kind: 'channel', category: 'general', name: id, ...opts }) as Room;

const msgEnvelope = (id: string, ts: number) => ({ ts, data: { t: 'msg', e: { id, authorId: 'peer', ts } } });
const pinEnvelope = (msgId: string, userId: string, ts: number) =>
  ({ ts, data: { t: 'pin', e: { msgId, userId, kind: 'pin', ts } } });

function seedKv(userId: string, roomId: string, items: unknown[]) {
  mem.set(streamLogKey(userId, roomId), JSON.stringify(items));
}

beforeEach(() => {
  mem.clear();
  resetFoldRoomCache();
  resetSpaceLevelMetaCache();
  vi.clearAllMocks();
  fakeClient.pull.mockImplementation(() => { throw new Error('unexpected network pull'); });
  fakeClient.batchPull.mockImplementation(() => { throw new Error('unexpected network batchPull'); });
  mockPeekNodeAccess.mockReturnValue(undefined);
});

describe('loadAllThreadsFromCache — zero network', () => {
  it('never calls client.pull/batchPull for the room logs', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] });
    seedKv(SESSION.userId, 'r1', [msgEnvelope('m1', 1)]);

    await loadAllThreadsFromCache(SESSION, 'sp-1', () => 0);

    expect(fakeClient.pull).not.toHaveBeenCalled();
    expect(fakeClient.batchPull).not.toHaveBeenCalled();
  });

  it('returns [] for a room with no cached log yet (never opened on this device)', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r-cold')], categories: [] });

    const threads = await loadAllThreadsFromCache(SESSION, 'sp-2', () => 0);

    expect(threads).toEqual([]);
  });

  it('folds a plaintext room straight from the persisted kv blob', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r-pub', { access: 'public', enc: false })], categories: [] });
    // A thread needs a parent + reply — seed two messages with a reply relationship.
    seedKv(SESSION.userId, 'r-pub', [
      { ts: 1, data: { t: 'msg', e: { id: 'parent', authorId: 'peer', ts: 1, text: 'hi' } } },
      { ts: 2, data: { t: 'msg', e: { id: 'reply', authorId: 'me', ts: 2, parentId: 'parent', text: 'yo' } } },
    ]);

    const threads = await loadAllThreadsFromCache(SESSION, 'sp-3', () => 0);

    expect(threads).toHaveLength(1);
    expect(threads[0]!.room.id).toBe('r-pub');
  });

  it('skips an enc room whose keyring has not been resolved this session', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r-enc', { enc: true })], categories: [] });
    seedKv(SESSION.userId, 'r-enc', [msgEnvelope('m1', 1)]);
    mockPeekNodeAccess.mockReturnValue(undefined); // not resolved yet

    const threads = await loadAllThreadsFromCache(SESSION, 'sp-4', () => 0);

    expect(threads).toEqual([]);
  });

  it('folds an enc room once its keyring is already resolved this session', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r-enc2', { enc: true })], categories: [] });
    seedKv(SESSION.userId, 'r-enc2', [
      { ts: 1, data: { t: 'msg', e: { id: 'p', authorId: 'peer', ts: 1, text: 'hi' } } },
      { ts: 2, data: { t: 'msg', e: { id: 'r', authorId: 'me', ts: 2, parentId: 'p', text: 'yo' } } },
    ]);
    mockPeekNodeAccess.mockReturnValue({ client: fakeClient as never, encryptor: { decrypt: async (d: unknown) => d } as never });

    const threads = await loadAllThreadsFromCache(SESSION, 'sp-5', () => 0);

    expect(threads).toHaveLength(1);
  });

  it('skips an invite+plaintext room entirely (no session-cache-key story)', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r-inv', { access: 'invite', enc: false })], categories: [] });
    seedKv(SESSION.userId, 'r-inv', [
      { ts: 1, data: { t: 'msg', e: { id: 'p', authorId: 'peer', ts: 1, text: 'hi' } } },
      { ts: 2, data: { t: 'msg', e: { id: 'r', authorId: 'me', ts: 2, parentId: 'p', text: 'yo' } } },
    ]);

    const threads = await loadAllThreadsFromCache(SESSION, 'sp-6', () => 0);

    expect(threads).toEqual([]);
  });
});

describe('loadAllPinsFromCache — zero network for room logs', () => {
  it('never calls client.pull/batchPull for the room logs (owner lookup still fires once)', async () => {
    mockReadSpaceAccess.mockResolvedValue({ owner: 'owner1', members: ['owner1'] } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] });
    seedKv(SESSION.userId, 'r1', [pinEnvelope('m1', 'owner1', 1)]);

    await loadAllPinsFromCache(SESSION, 'sp-7');

    expect(fakeClient.pull).not.toHaveBeenCalled();
    expect(fakeClient.batchPull).not.toHaveBeenCalled();
    expect(mockReadSpaceAccess).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the space has no resolvable owner', async () => {
    mockReadSpaceAccess.mockResolvedValue({ owner: null, members: [] } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] });

    const pins = await loadAllPinsFromCache(SESSION, 'sp-8');

    expect(pins).toEqual([]);
  });

  it('folds the owner\'s pinned message from the persisted kv blob', async () => {
    mockReadSpaceAccess.mockResolvedValue({ owner: 'owner1', members: ['owner1'] } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r-pub', { access: 'public', enc: false })], categories: [] });
    seedKv(SESSION.userId, 'r-pub', [
      { ts: 1, data: { t: 'msg', e: { id: 'm1', authorId: 'owner1', ts: 1, text: 'pin me' } } },
      pinEnvelope('m1', 'owner1', 2),
    ]);

    const pins = await loadAllPinsFromCache(SESSION, 'sp-9');

    expect(pins).toHaveLength(1);
    expect(pins[0]!.msg.id).toBe('m1');
  });
});
