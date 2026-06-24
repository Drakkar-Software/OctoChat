import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for loadSpaceStats. All rooms now live in a plaintext object index;
 * access/enc per node (not per space). Mocks cover the external boundaries:
 * 1. getSpaceClient (starfish-spaces) + buildNodeAccessShared (node-access-cache) — auth + keyring
 * 2. listSpaceRooms (cross-room) — coalesced room list from the object index
 * 3. foldRoomCached (stream-log) — warm-start aware log fold
 * resolveEdit and buildThreadDigest have their own suites; stubs isolate stats arithmetic.
 */
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: vi.fn(() => ({})) };
});
vi.mock('../starfish/node-access-cache', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), buildNodeAccessShared: vi.fn() };
});
// listSpaceRooms is now the room-list boundary (replaces readIndexRooms).
vi.mock('../messaging/cross-room', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), listSpaceRooms: vi.fn() };
});
// foldRoomCached is now the log-fold boundary (replaces pullAndFold).
vi.mock('../messaging/stream-log', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), foldRoomCached: vi.fn() };
});
vi.mock('../format/message-view', () => ({ resolveEdit: vi.fn() }));
vi.mock('../messaging/threads', () => ({ buildThreadDigest: vi.fn(() => []) }));

import { loadSpaceStats } from './space-stats';
import { getSpaceClient } from '@drakkar.software/starfish-spaces';
import { buildNodeAccessShared } from '../starfish/node-access-cache';
import { listSpaceRooms } from '../messaging/cross-room';
import { foldRoomCached } from '../messaging/stream-log';
import { resolveEdit } from '../format/message-view';
import { buildThreadDigest } from '../messaging/threads';
import type { StoredMsg } from '../format/message-view';
import type { Room } from '../domain/types';

const mockGetSpaceClient = vi.mocked(getSpaceClient);
const mockBuildNodeAccessShared = vi.mocked(buildNodeAccessShared);
const mockListSpaceRooms = vi.mocked(listSpaceRooms);
const mockFoldRoomCached = vi.mocked(foldRoomCached);
const mockResolveEdit = vi.mocked(resolveEdit);
const mockBuildThreadDigest = vi.mocked(buildThreadDigest);

const SESSION = { userId: 'self' } as never;
const SPACE = 'sp-abc';
const FAKE_CLIENT = {} as never;

const room = (id: string, opts: Partial<Room> = {}): Room =>
  ({ id, spaceId: SPACE, kind: 'channel', ...opts }) as Room;
const msg = (id: string, over: Partial<StoredMsg> = {}): StoredMsg =>
  ({ id, authorId: 'u1', ts: 1, ...over }) as StoredMsg;

function makeFoldResult(messages: StoredMsg[], items: unknown[] = []) {
  return { data: { messages, edits: [], pins: [] }, items };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSpaceClient.mockReturnValue(FAKE_CLIENT);
  mockBuildNodeAccessShared.mockResolvedValue(null); // default: no enc access
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
    mockFoldRoomCached.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({
      rooms: 1,
      messages: 2, // m2 folded out (delete)
      threads: 1,
      attachments: 2, // m2 + m3 — deleted attachment still occupies space
      bytes: JSON.stringify(items).length + 500 + 1000,
      partial: false,
    });
    expect(mockBuildNodeAccessShared).toHaveBeenCalled();
  });

  it('treats an empty room (no log yet) as zero, not an error', async () => {
    mockListSpaceRooms.mockResolvedValue([room('r1')]);
    mockFoldRoomCached.mockResolvedValue({ data: { messages: [], edits: [], pins: [] }, items: [] } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toMatchObject({ rooms: 1, messages: 0, attachments: 0, bytes: 0, partial: false });
  });
});

describe('loadSpaceStats — encrypted (enc: true) rooms', () => {
  it('opens keyring via buildNodeAccessShared and folds with encryptor', async () => {
    const encClient = {} as never;
    const encryptor = {} as never;
    mockBuildNodeAccessShared.mockResolvedValue({ client: encClient, encryptor });
    const messages = [msg('m1'), msg('m2')];
    const items = [{}, {}];
    mockListSpaceRooms.mockResolvedValue([room('r1', { enc: true })]);
    mockFoldRoomCached.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.messages).toBe(2);
    expect(stats.rooms).toBe(1);
    // foldRoomCached called with enc client + encryptor at args [userId, client, enc, roomId, pullPath]
    const [, clientArg, encArg] = mockFoldRoomCached.mock.calls[0]!;
    expect(clientArg).toBe(encClient);
    expect(encArg).toBe(encryptor);
  });
});

describe('loadSpaceStats — public rooms', () => {
  it('folds a public room via streamPubRoomPull (null encryptor)', async () => {
    const messages = [msg('pub1'), msg('pub2')];
    const items = [{}, {}];
    mockListSpaceRooms.mockResolvedValue([room('r1', { access: 'public', enc: false })]);
    mockFoldRoomCached.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.messages).toBe(2);
    expect(stats.rooms).toBe(1);
    // Public room with enc:false → null encryptor, streamPubRoomPull path
    const [, , encArg, , pathArg] = mockFoldRoomCached.mock.calls[0]!;
    expect(encArg).toBeNull();
    expect(String(pathArg)).toContain('pub/'); // streamPubRoomPull path
  });
});

describe('loadSpaceStats — invite-plaintext (access:invite, enc:false) rooms', () => {
  it('folds an invite-plaintext room via streamInvRoomPull, not streamRoomPull', async () => {
    const messages = [msg('inv1')];
    const items = [{}];
    mockListSpaceRooms.mockResolvedValue([room('r1', { access: 'invite', enc: false })]);
    mockFoldRoomCached.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.messages).toBe(1);
    // invite-plaintext: pull path must use streaminv `/n/{roomId}/log`, not streamchat
    const [, , encArg, , pathArg] = mockFoldRoomCached.mock.calls[0]!;
    expect(encArg).toBeNull();
    expect(String(pathArg)).toContain('/n/'); // streaminv path segment
    expect(String(pathArg)).not.toContain('/streams/r1');
  });
});

describe('loadSpaceStats — failure handling', () => {
  it('sets partial and skips a room whose log fold throws, keeping other rooms', async () => {
    mockListSpaceRooms.mockResolvedValue([room('good'), room('bad')]);
    mockFoldRoomCached.mockImplementation(async (_uid, _cl, _enc, roomId) => {
      if (roomId === 'bad') throw new Error('unreachable');
      return makeFoldResult([msg('m1')], [{}]) as never;
    });

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.partial).toBe(true);
    expect(stats.rooms).toBe(2);
    expect(stats.messages).toBe(1); // good room counted
  });

  it('returns empty snapshot when room list is unreadable', async () => {
    mockListSpaceRooms.mockRejectedValue(new Error('network'));

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({ rooms: 0, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: false });
  });
});
