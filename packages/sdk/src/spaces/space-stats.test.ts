import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for loadSpaceStats. All rooms now live in a plaintext object index;
 * access/enc per node (not per space). Mocks cover the three external boundaries:
 * 1. getSpaceClient + buildNodeAccess (octospaces-sdk) — auth + keyring
 * 2. readIndexRooms (object-index) — room list with access/enc flags
 * 3. pullAndFold (stream-log) — the actual log fold
 * resolveEdit and buildThreadDigest have their own suites; stubs isolate stats arithmetic.
 */
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: vi.fn(() => ({})), buildNodeAccess: vi.fn() };
});
vi.mock('../starfish/object-index', () => ({ readIndexRooms: vi.fn() }));
vi.mock('../messaging/stream-log', () => ({ pullAndFold: vi.fn(), fanOut: vi.fn(() => ({ messages: [], edits: [], pins: [] })) }));
vi.mock('../format/message-view', () => ({ resolveEdit: vi.fn() }));
vi.mock('../messaging/threads', () => ({ buildThreadDigest: vi.fn(() => []) }));

import { loadSpaceStats } from './space-stats';
import { buildNodeAccess, getSpaceClient } from '@drakkar.software/octospaces-sdk';
import { readIndexRooms } from '../starfish/object-index';
import { pullAndFold } from '../messaging/stream-log';
import { resolveEdit } from '../format/message-view';
import { buildThreadDigest } from '../messaging/threads';
import type { StoredMsg } from '../format/message-view';
import type { Room } from '../domain/types';

const mockGetSpaceClient = vi.mocked(getSpaceClient);
const mockBuildNodeAccess = vi.mocked(buildNodeAccess);
const mockReadIndexRooms = vi.mocked(readIndexRooms);
const mockPullAndFold = vi.mocked(pullAndFold);
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
  mockBuildNodeAccess.mockResolvedValue(null); // default: no enc access
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
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);
    mockPullAndFold.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({
      rooms: 1,
      messages: 2, // m2 folded out (delete)
      threads: 1,
      attachments: 2, // m2 + m3 — deleted attachment still occupies space
      bytes: JSON.stringify(items).length + 500 + 1000,
      partial: false,
    });
    // plaintext room: buildNodeAccess called but returns null → null encryptor
    expect(mockBuildNodeAccess).toHaveBeenCalled();
  });

  it('treats an empty room (no log yet) as zero, not an error', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);
    mockPullAndFold.mockResolvedValue({ data: { messages: [], edits: [], pins: [] }, items: [] } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toMatchObject({ rooms: 1, messages: 0, attachments: 0, bytes: 0, partial: false });
  });
});

describe('loadSpaceStats — encrypted (enc: true) rooms', () => {
  it('opens keyring via buildNodeAccess and decrypts the room log', async () => {
    const encClient = {} as never;
    const encryptor = {} as never;
    mockBuildNodeAccess.mockResolvedValue({ client: encClient, encryptor });
    const messages = [msg('m1'), msg('m2')];
    const items = [{}, {}];
    mockReadIndexRooms.mockResolvedValue({
      rooms: [room('r1', { enc: true })],
      categories: [],
    } as never);
    mockPullAndFold.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.messages).toBe(2);
    expect(stats.rooms).toBe(1);
    // pullAndFold called with the enc access client + encryptor
    expect(mockPullAndFold).toHaveBeenCalledWith(encClient, encryptor, expect.any(String));
  });
});

describe('loadSpaceStats — public rooms', () => {
  it('folds a public room via streamPubRoomPull (null encryptor)', async () => {
    const messages = [msg('pub1'), msg('pub2')];
    const items = [{}, {}];
    mockReadIndexRooms.mockResolvedValue({
      rooms: [room('r1', { access: 'public', enc: false })],
      categories: [],
    } as never);
    mockPullAndFold.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.messages).toBe(2);
    expect(stats.rooms).toBe(1);
    // Public room with enc:false → buildNodeAccess returns null → null encryptor
    const [, encArg, pathArg] = mockPullAndFold.mock.calls[0];
    expect(encArg).toBeNull();
    expect(pathArg).toContain('pub/'); // streamPubRoomPull path
  });
});

describe('loadSpaceStats — invite-plaintext (access:invite, enc:false) rooms', () => {
  it('folds an invite-plaintext room via streamInvRoomPull, not streamRoomPull', async () => {
    const messages = [msg('inv1')];
    const items = [{}];
    mockReadIndexRooms.mockResolvedValue({
      rooms: [room('r1', { access: 'invite', enc: false })],
      categories: [],
    } as never);
    mockPullAndFold.mockResolvedValue({ data: { messages, edits: [], pins: [] }, items } as never);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.messages).toBe(1);
    // invite-plaintext: pull path must use streaminv `streams/n/{roomId}/log`, not streamchat `streams/{roomId}`
    const [, encArg, pathArg] = mockPullAndFold.mock.calls[0];
    expect(encArg).toBeNull();
    expect(pathArg).toContain('/n/'); // streaminv path segment
    expect(pathArg).not.toContain('/streams/r1'); // must NOT hit the streamchat path
  });
});

describe('loadSpaceStats — failure handling', () => {
  it('sets partial and skips a room whose log pull throws, keeping other rooms', async () => {
    mockReadIndexRooms.mockResolvedValue({
      rooms: [room('good'), room('bad')],
      categories: [],
    } as never);
    mockPullAndFold.mockImplementation(async (_c, _e, path) => {
      if (String(path).includes('bad')) throw new Error('unreachable');
      return makeFoldResult([msg('m1')], [{}]);
    });

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats.partial).toBe(true);
    expect(stats.rooms).toBe(2);
    expect(stats.messages).toBe(1); // good room counted
  });

  it('returns empty snapshot when index is unreadable', async () => {
    mockReadIndexRooms.mockResolvedValue(null);

    const stats = await loadSpaceStats(SESSION, SPACE);

    expect(stats).toEqual({ rooms: 0, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: false });
  });
});
