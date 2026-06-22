/**
 * Unit tests for notification-preview.ts — specifically the cold-start index-miss path
 * where `room` is absent from the object index (fresh device, first notification).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────────

const mockReadIndexRooms = vi.fn(async () => null);
vi.mock('../starfish/object-index', () => ({
  readIndexRooms: (...args: unknown[]) => mockReadIndexRooms(...args),
}));

const mockBuildNodeAccess = vi.fn(async () => null);
const mockGetSpaceClient = vi.fn(() => ({ pull: async () => [] }));
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    buildNodeAccess: (...args: unknown[]) => mockBuildNodeAccess(...args),
    getSpaceClient: (...args: unknown[]) => mockGetSpaceClient(...args),
  };
});

const mockReadPseudo = vi.fn(async () => null);
vi.mock('../starfish/client', () => ({
  readPseudo: (...args: unknown[]) => mockReadPseudo(...args),
}));

// pullAndFold is called on the client; we mock client.pull via the spaceClient mock above.
// To control what pullAndFold returns we mock pullAndFold directly.
const mockPullAndFold = vi.fn(async () => ({ data: { messages: [], reactions: [], edits: [], pins: [] }, items: [] }));
vi.mock('../messaging/stream-log', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), pullAndFold: (...args: unknown[]) => mockPullAndFold(...args) };
});

import { loadLatestMessagePreview } from './notification-preview';
import { clearBuildNodeAccessCache } from '../starfish/node-access-cache';
import type { Session } from '../starfish/identity';

const SESSION = { userId: 'u1', name: 'Alice' } as unknown as Session;
// Room in space sp-abc: room id = sp-abc-general
const ROOM_ID = 'sp-abc-general';

function makeMsg(authorId = 'u2', text = 'hello') {
  return { id: 'm1', authorId, text, ts: 1000 };
}

beforeEach(() => {
  mockReadIndexRooms.mockReset();
  mockBuildNodeAccess.mockReset();
  mockGetSpaceClient.mockReset();
  mockReadPseudo.mockReset();
  mockPullAndFold.mockReset();
  clearBuildNodeAccessCache();

  // Defaults: index returns no rooms; buildNodeAccess returns null; pseudo returns null.
  mockReadIndexRooms.mockResolvedValue(null);
  mockBuildNodeAccess.mockResolvedValue(null);
  mockGetSpaceClient.mockReturnValue({ pull: async () => [] });
  mockReadPseudo.mockResolvedValue(null);
  mockPullAndFold.mockResolvedValue({ data: { messages: [], reactions: [], edits: [], pins: [] }, items: [] });
});

// ── Index-miss + member keyring (cold-start happy path) ────────────────────────

describe('loadLatestMessagePreview — cold-start index miss', () => {
  it('returns a real preview when room absent from index but member keyring is available', async () => {
    // Index miss: readIndexRooms returns {rooms:[], categories:[]}
    mockReadIndexRooms.mockResolvedValue({ rooms: [], categories: [] });

    // Member keyring available: buildNodeAccess returns an encryptor
    const mockEncryptor = { decrypt: vi.fn(async (d: unknown) => d) };
    const mockEncClient = { pull: async () => [] };
    mockBuildNodeAccess.mockResolvedValue({ client: mockEncClient, encryptor: mockEncryptor });

    // The pull returns a message
    mockPullAndFold.mockResolvedValue({
      data: { messages: [makeMsg('u2', 'build passed')], reactions: [], edits: [], pins: [] },
      items: [],
    });
    mockReadPseudo.mockResolvedValue('CI Bot');

    const preview = await loadLatestMessagePreview(SESSION, ROOM_ID);

    expect(preview).not.toBeNull();
    expect(preview).toContain('build passed');
    // buildNodeAccess was called (keyring probed on index miss)
    expect(mockBuildNodeAccess).toHaveBeenCalledWith(SESSION, 'sp-abc', ROOM_ID, { enc: true });
    // The enc client was used for pullAndFold (not the bare spaceClient)
    const [clientArg, encryptorArg] = mockPullAndFold.mock.calls[0] as [unknown, unknown];
    expect(clientArg).toBe(mockEncClient);
    expect(encryptorArg).toBe(mockEncryptor);
  });

  it('returns null (generic banner) when room absent from index and no keyring', async () => {
    // Index miss + no keyring
    mockReadIndexRooms.mockResolvedValue({ rooms: [], categories: [] });
    mockBuildNodeAccess.mockResolvedValue(null);

    // Pull returns something but without an encryptor the sealed blobs fold to nothing
    mockPullAndFold.mockResolvedValue({ data: { messages: [], reactions: [], edits: [], pins: [] }, items: [] });

    const preview = await loadLatestMessagePreview(SESSION, ROOM_ID);
    expect(preview).toBeNull();
  });
});

// ── Known room, enc:true (existing path still works) ──────────────────────────

describe('loadLatestMessagePreview — known enc room', () => {
  it('returns null when buildNodeAccess fails for a known enc:true room', async () => {
    mockReadIndexRooms.mockResolvedValue({
      rooms: [{ id: ROOM_ID, spaceId: 'sp-abc', access: 'space', enc: true, kind: 'channel' }],
      categories: [],
    });
    mockBuildNodeAccess.mockResolvedValue(null);

    const preview = await loadLatestMessagePreview(SESSION, ROOM_ID);
    expect(preview).toBeNull();
  });

  it('returns a preview when buildNodeAccess succeeds for a known enc:true room', async () => {
    mockReadIndexRooms.mockResolvedValue({
      rooms: [{ id: ROOM_ID, spaceId: 'sp-abc', access: 'space', enc: true, kind: 'channel' }],
      categories: [],
    });
    const enc = { decrypt: vi.fn(async (d: unknown) => d) };
    const encClient = { pull: async () => [] };
    mockBuildNodeAccess.mockResolvedValue({ client: encClient, encryptor: enc });
    mockPullAndFold.mockResolvedValue({
      data: { messages: [makeMsg()], reactions: [], edits: [], pins: [] },
      items: [],
    });
    mockReadPseudo.mockResolvedValue('Bob');

    const preview = await loadLatestMessagePreview(SESSION, ROOM_ID);
    expect(preview).toContain('hello');
  });
});

// ── Explicit spaceId override (ticket rooms have no embedded space in their id) ──

describe('loadLatestMessagePreview — explicit spaceId', () => {
  // spaceIdFromRoomId('ticket-deadbeef') === 'ticket-deadbeef' (a bogus, non-existent space).
  const TICKET_ID = 'ticket-deadbeef';

  it('uses the passed spaceId (not the lossy room-id derivation) for a ticket room', async () => {
    mockReadIndexRooms.mockResolvedValue({
      rooms: [{ id: TICKET_ID, spaceId: 'sp-desk', access: 'invite', enc: true, kind: 'channel' }],
      categories: [],
    });
    const enc = { decrypt: vi.fn(async (d: unknown) => d) };
    mockBuildNodeAccess.mockResolvedValue({ client: { pull: async () => [] }, encryptor: enc });
    mockPullAndFold.mockResolvedValue({
      data: { messages: [makeMsg('u2', 'ticket reply')], reactions: [], edits: [], pins: [] },
      items: [],
    });
    mockReadPseudo.mockResolvedValue('Requester');

    const preview = await loadLatestMessagePreview(SESSION, TICKET_ID, 'sp-desk');

    expect(preview).toContain('ticket reply');
    // The desk space the event carried — NOT 'ticket-deadbeef'.
    expect(mockGetSpaceClient).toHaveBeenCalledWith('sp-desk', SESSION);
    expect(mockBuildNodeAccess).toHaveBeenCalledWith(SESSION, 'sp-desk', TICKET_ID, { enc: true });
  });

  it('without an explicit spaceId, falls back to the (lossy) room-id derivation', async () => {
    mockReadIndexRooms.mockResolvedValue({ rooms: [], categories: [] });
    await loadLatestMessagePreview(SESSION, TICKET_ID);
    // Back-compat: derives 'ticket-deadbeef' from the id — which is exactly why the
    // explicit spaceId arg exists (the resolver would otherwise open a bogus space).
    expect(mockGetSpaceClient).toHaveBeenCalledWith('ticket-deadbeef', SESSION);
  });
});
