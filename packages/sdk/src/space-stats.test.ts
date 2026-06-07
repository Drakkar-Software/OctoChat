import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock every value-import of space-stats so the module loads under Node with no
// Expo/Starfish runtime. Types are erased, so the SDK + identity/types imports need
// no mock. `resolveEdit` and `buildThreadDigest` have their own suites — stub them so
// these tests isolate space-stats' OWN arithmetic (byte summing, net-of-deletes,
// attachments-incl-deleted, the partial/no-keyring branches).
vi.mock('./starfish/space-encryptor', () => ({ buildSpaceEncryptor: vi.fn() }));
vi.mock('./message-view', () => ({ resolveEdit: vi.fn() }));
vi.mock('./starfish/client', () => ({ makeClient: vi.fn() }));
vi.mock('./starfish/paths', () => ({
  objIndexPull: (id: string) => `objindex/${id}`,
  roomPull: (id: string) => `merge/${id}`,
  streamRoomPull: (id: string) => `stream/${id}`,
  pubspaceRoomPull: (_o: string, _s: string, id: string) => `pub/${id}`,
  pubstreamRoomPull: (_o: string, _s: string, id: string) => `pubstream/${id}`,
}));
// The private room list comes from the encrypted object index, not `_rooms`.
vi.mock('./starfish/object-index', () => ({ readIndexRooms: vi.fn() }));
vi.mock('./starfish/pubspace', () => ({
  isPublicSpaceId: vi.fn(),
  publicSpaceAuth: vi.fn(),
  readPublicRoomsDoc: vi.fn(),
}));
vi.mock('./threads', () => ({ buildThreadDigest: vi.fn(() => []) }));

import { loadSpaceStats } from './space-stats';
import { buildSpaceEncryptor } from './starfish/space-encryptor';
import { resolveEdit } from './message-view';
import { isPublicSpaceId, publicSpaceAuth, readPublicRoomsDoc } from './starfish/pubspace';
import { readIndexRooms } from './starfish/object-index';
import { buildThreadDigest } from './threads';
import type { StoredMsg } from './message-view';
import type { Room } from './types';

const mockBuildSpaceEncryptor = vi.mocked(buildSpaceEncryptor);
const mockResolveEdit = vi.mocked(resolveEdit);
const mockIsPublicSpaceId = vi.mocked(isPublicSpaceId);
const mockPublicSpaceAuth = vi.mocked(publicSpaceAuth);
const mockReadPublicRoomsDoc = vi.mocked(readPublicRoomsDoc);
const mockReadIndexRooms = vi.mocked(readIndexRooms);
const mockBuildThreadDigest = vi.mocked(buildThreadDigest);

const SESSION = { userId: 'self', accountClient: {} } as never;

// Any non-`stream` kind takes the merge fold path; 'channel' is the default room.
const room = (id: string, kind: Room['kind'] = 'channel'): Room => ({ id, kind }) as Room;
const msg = (id: string, over: Partial<StoredMsg> = {}): StoredMsg =>
  ({ id, authorId: 'u1', ts: 1, ...over }) as StoredMsg;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPublicSpaceId.mockReturnValue(false);
  mockResolveEdit.mockReturnValue(undefined); // nothing deleted unless a test says so
  mockBuildThreadDigest.mockReturnValue([]);
});

describe('loadSpaceStats — private merge room', () => {
  it('sums doc bytes + every attachment size, counts messages net of deletes, attachments incl. deleted', async () => {
    const encDoc = { _encrypted: true, blob: 'ciphertext' };
    const plain = {
      messages: [
        msg('m1'), // live, no attachment
        msg('m2', { attachment: { size: 500 } as never }), // DELETED but attachment still occupies space
        msg('m3', { attachment: { size: 1000 } as never }), // live + attachment
      ],
      edits: [],
    };
    // m2 is a delete tombstone; the rest resolve to no edit.
    mockResolveEdit.mockImplementation((_e, id) => (id === 'm2' ? ({ kind: 'delete' } as never) : undefined));
    mockBuildThreadDigest.mockReturnValue([{} as never]); // 1 thread

    const pull = vi.fn(async () => ({ data: encDoc }));
    const decrypt = vi.fn(async () => plain);
    mockBuildSpaceEncryptor.mockResolvedValue({ client: { pull } as never, enc: { decrypt } as never } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);

    const stats = await loadSpaceStats(SESSION, 'space1');

    const expectedDocBytes = JSON.stringify(encDoc).length;
    expect(stats).toEqual({
      rooms: 1,
      messages: 2, // m2 folded out
      threads: 1,
      attachments: 2, // m2 + m3 — deleted message's attachment still counts
      bytes: expectedDocBytes + 500 + 1000,
      partial: false,
    });
    expect(decrypt).toHaveBeenCalledWith(encDoc);
  });

  it('uses plaintext doc bytes when the room doc is not encrypted', async () => {
    const plainDoc = { messages: [msg('m1')], edits: [] };
    const pull = vi.fn(async () => ({ data: plainDoc })); // no _encrypted flag
    const decrypt = vi.fn();
    mockBuildSpaceEncryptor.mockResolvedValue({ client: { pull } as never, enc: { decrypt } as never } as never);
    mockReadIndexRooms.mockResolvedValue({ rooms: [room('r1')], categories: [] } as never);

    const stats = await loadSpaceStats(SESSION, 'space1');

    expect(decrypt).not.toHaveBeenCalled(); // plaintext branch skips decrypt
    expect(stats.bytes).toBe(JSON.stringify(plainDoc).length);
    expect(stats.messages).toBe(0); // unencrypted merge docs expose no message array to fold
  });

  it('treats an empty room (no doc) as zero, not an error', async () => {
    const pull = vi.fn(async () => null); // no doc yet
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
  it('sets partial and skips a room whose decrypt throws, keeping other rooms', async () => {
    const goodDoc = { _encrypted: true, blob: 'ok' };
    const goodPlain = { messages: [msg('m1')], edits: [] };
    const pull = vi.fn(async (path: string) =>
      path === 'merge/good' ? { data: goodDoc } : { data: { _encrypted: true, blob: 'bad' } },
    );
    const decrypt = vi.fn(async (d: { blob: string }) => {
      if (d.blob === 'bad') throw new Error('undecryptable');
      return goodPlain;
    });
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

describe('loadSpaceStats — public space', () => {
  it('folds public merge rooms via the public-pull path (plaintext, no decrypt)', async () => {
    mockIsPublicSpaceId.mockReturnValue(true);
    mockPublicSpaceAuth.mockReturnValue({ cap: 'c', signingKey: 'k', ownerId: 'owner' } as never);

    const roomDoc = { messages: [msg('m1'), msg('m2', { attachment: { size: 42 } as never })], edits: [] };
    const pull = vi.fn(async () => ({ data: roomDoc }));
    const { makeClient } = await import('./starfish/client');
    vi.mocked(makeClient).mockReturnValue({ pull } as never);
    mockReadPublicRoomsDoc.mockResolvedValue({ rooms: [room('r1')] } as never);

    const stats = await loadSpaceStats(SESSION, 'pub-space');

    expect(stats.rooms).toBe(1);
    expect(stats.messages).toBe(2);
    expect(stats.attachments).toBe(1);
    expect(stats.bytes).toBe(JSON.stringify(roomDoc).length + 42);
  });
});
