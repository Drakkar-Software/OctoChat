import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock every value-import of space-stats so the module loads under Node with no
// Expo/Starfish runtime. Types are erased, so the SDK + identity/types imports need
// no mock. `resolveEdit` and `buildThreadDigest` have their own suites — stub them so
// these tests isolate space-stats' OWN arithmetic (byte summing, net-of-deletes,
// attachments-incl-deleted, the partial/no-keyring branches).
//
// Every room is an APPEND-ONLY log now (stream↔channel merged): a pull returns the
// `{ts,data}[]` log elements; a private element's `data` is the sealed envelope
// (decrypt → `{t,e}`), a public element's `data` IS the plaintext envelope.
vi.mock('../starfish/space-encryptor', () => ({ buildSpaceEncryptor: vi.fn() }));
vi.mock('../format/message-view', () => ({ resolveEdit: vi.fn() }));
vi.mock('../starfish/client', () => ({ makeClient: vi.fn() }));
vi.mock('../starfish/paths', () => ({
  objIndexPull: (id: string) => `objindex/${id}`,
  streamRoomPull: (id: string) => `stream/${id}`,
  pubstreamRoomPull: (_o: string, _s: string, id: string) => `pubstream/${id}`,
}));
// The private room list comes from the encrypted object index, not `_rooms`.
vi.mock('../starfish/object-index', () => ({ readIndexRooms: vi.fn() }));
vi.mock('../starfish/pubspace', () => ({
  isPublicSpaceId: vi.fn(),
  publicSpaceAuth: vi.fn(),
  readPublicRoomsDoc: vi.fn(),
}));
vi.mock('../messaging/threads', () => ({ buildThreadDigest: vi.fn(() => []) }));

import { loadSpaceStats } from './space-stats';
import { buildSpaceEncryptor } from '../starfish/space-encryptor';
import { resolveEdit } from '../format/message-view';
import { isPublicSpaceId, publicSpaceAuth, readPublicRoomsDoc } from '../starfish/pubspace';
import { readIndexRooms } from '../starfish/object-index';
import { buildThreadDigest } from '../messaging/threads';
import type { StoredMsg } from '../format/message-view';
import type { Room } from '../domain/types';

const mockBuildSpaceEncryptor = vi.mocked(buildSpaceEncryptor);
const mockResolveEdit = vi.mocked(resolveEdit);
const mockIsPublicSpaceId = vi.mocked(isPublicSpaceId);
const mockPublicSpaceAuth = vi.mocked(publicSpaceAuth);
const mockReadPublicRoomsDoc = vi.mocked(readPublicRoomsDoc);
const mockReadIndexRooms = vi.mocked(readIndexRooms);
const mockBuildThreadDigest = vi.mocked(buildThreadDigest);

const SESSION = { userId: 'self', accountClient: {} } as never;

const room = (id: string, kind: Room['kind'] = 'channel'): Room => ({ id, kind }) as Room;
const msg = (id: string, over: Partial<StoredMsg> = {}): StoredMsg =>
  ({ id, authorId: 'u1', ts: 1, ...over }) as StoredMsg;
/** One append-log element whose `data` is the (would-be-sealed) message envelope. */
const item = (m: StoredMsg) => ({ ts: 1, data: { t: 'msg', e: m } });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPublicSpaceId.mockReturnValue(false);
  mockResolveEdit.mockReturnValue(undefined); // nothing deleted unless a test says so
  mockBuildThreadDigest.mockReturnValue([]);
});

describe('loadSpaceStats — private room (append log)', () => {
  it('sums log bytes + every attachment size, counts messages net of deletes, attachments incl. deleted', async () => {
    const items = [
      item(msg('m1')), // live, no attachment
      item(msg('m2', { attachment: { size: 500 } as never })), // DELETED but attachment still occupies space
      item(msg('m3', { attachment: { size: 1000 } as never })), // live + attachment
    ];
    // m2 is a delete tombstone; the rest resolve to no edit.
    mockResolveEdit.mockImplementation((_e, id) => (id === 'm2' ? ({ kind: 'delete' } as never) : undefined));
    mockBuildThreadDigest.mockReturnValue([{} as never]); // 1 thread

    const pull = vi.fn(async () => items);
    const decrypt = vi.fn(async (d: unknown) => d); // sealed element's data IS the envelope
    mockBuildSpaceEncryptor.mockResolvedValue({ client: { pull } as never, enc: { decrypt } as never } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);

    const stats = await loadSpaceStats(SESSION, 'space1');

    expect(stats).toEqual({
      rooms: 1,
      messages: 2, // m2 folded out
      threads: 1,
      attachments: 2, // m2 + m3 — deleted message's attachment still counts
      bytes: JSON.stringify(items).length + 500 + 1000,
      partial: false,
    });
    expect(decrypt).toHaveBeenCalledWith(items[0].data);
  });

  it('skips a single undecryptable element but still counts the rest (no partial)', async () => {
    const items = [item(msg('m1')), { ts: 1, data: 'bad' }];
    const pull = vi.fn(async () => items);
    const decrypt = vi.fn(async (d: unknown) => {
      if (d === 'bad') throw new Error('undecryptable');
      return d;
    });
    mockBuildSpaceEncryptor.mockResolvedValue({ client: { pull } as never, enc: { decrypt } as never } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);

    const stats = await loadSpaceStats(SESSION, 'space1');

    expect(stats.messages).toBe(1); // the good element still counted
    expect(stats.partial).toBe(false); // a per-element skip is non-fatal
  });

  it('treats an empty room (no log yet) as zero, not an error', async () => {
    const pull = vi.fn(async () => null); // no log yet
    mockBuildSpaceEncryptor.mockResolvedValue({
      client: { pull } as never,
      enc: { decrypt: vi.fn() } as never,
    } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);

    const stats = await loadSpaceStats(SESSION, 'space1');

    expect(stats).toMatchObject({ rooms: 1, messages: 0, attachments: 0, bytes: 0, partial: false });
  });
});

describe('loadSpaceStats — failure handling', () => {
  it('sets partial and skips a room whose log PULL throws, keeping other rooms', async () => {
    const pull = vi.fn(async (path: string) => {
      if (path === 'stream/bad') throw new Error('unreachable');
      return [item(msg('m1'))];
    });
    const decrypt = vi.fn(async (d: unknown) => d);
    mockBuildSpaceEncryptor.mockResolvedValue({ client: { pull } as never, enc: { decrypt } as never } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('good'), room('bad')], categories: [] } as never);

    const stats = await loadSpaceStats(SESSION, 'space1');

    expect(stats.partial).toBe(true);
    expect(stats.rooms).toBe(2);
    expect(stats.messages).toBe(1); // the good room still counted
  });

  it('returns an empty snapshot when there is no keyring (the room list lives in the encrypted index)', async () => {
    mockBuildSpaceEncryptor.mockResolvedValue(null); // no keyring for this space yet

    const stats = await loadSpaceStats(SESSION, 'space1');

    // Without the keyring we can't read (or even count) the encrypted index, so there is
    // nothing to report — an empty, non-partial snapshot rather than a misleading count.
    expect(stats).toEqual({ rooms: 0, messages: 0, threads: 0, attachments: 0, bytes: 0, partial: false });
  });
});

describe('loadSpaceStats — public space (append log)', () => {
  it('folds public rooms via the pubstream path (plaintext, no decrypt)', async () => {
    mockIsPublicSpaceId.mockReturnValue(true);
    mockPublicSpaceAuth.mockReturnValue({ cap: 'c', signingKey: 'k', ownerId: 'owner' } as never);

    const items = [item(msg('m1')), item(msg('m2', { attachment: { size: 42 } as never }))];
    const pull = vi.fn(async () => items);
    const { makeClient } = await import('../starfish/client');
    vi.mocked(makeClient).mockReturnValue({ pull } as never);
    mockReadPublicRoomsDoc.mockResolvedValue({ rooms: [room('r1')] } as never);

    const stats = await loadSpaceStats(SESSION, 'pub-space');

    expect(stats.rooms).toBe(1);
    expect(stats.messages).toBe(2);
    expect(stats.attachments).toBe(1);
    expect(stats.bytes).toBe(JSON.stringify(items).length + 42);
  });
});
