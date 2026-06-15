/**
 * Tests for the OctoChat object-index helpers: readIndexRooms, readPrivateSpaceRooms,
 * pushIndexSeed, seedSpaceObjectIndex.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/octospaces-sdk')>();
  return { ...actual, getSpaceClient: vi.fn() };
});

import { getSpaceClient } from '@drakkar.software/octospaces-sdk';
import { readIndexRooms, pushIndexSeed, seedSpaceObjectIndex, readPrivateSpaceRooms } from './object-index';
import type { Session } from './identity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(overrides?: Record<string, unknown>) {
  return {
    pull: vi.fn(),
    push: vi.fn(),
    ...overrides,
  };
}

function makeSession(): Session {
  return {
    userId: 'u-owner',
    keys: {} as never,
    chatClient: {} as never,
    accountClient: {} as never,
    spacesRegistryClient: {} as never,
  } as Session;
}

/** Build a minimal ObjectNode-shaped room entry (type:'room', as seedIndexNodes produces). */
function makeRoomNode(id: string, name = 'general') {
  // objectsToRoomCategories filters on type === 'room', not 'channel'
  return { id, type: 'room', title: name, parentId: null, order: 0, updatedAt: 0, access: 'space' as const, enc: true };
}

beforeEach(() => vi.clearAllMocks());

// ── readIndexRooms ────────────────────────────────────────────────────────────

describe('readIndexRooms', () => {
  it('returns null when pull fails (no data)', async () => {
    const client = makeClient({ pull: vi.fn().mockResolvedValue(null) });
    const result = await readIndexRooms(client as never, null, '/pull/spaces/sp-abc/objects/_index', 'sp-abc');
    expect(result).toBeNull();
  });

  it('returns null when data has no objects array', async () => {
    const client = makeClient({ pull: vi.fn().mockResolvedValue({ data: {}, hash: null }) });
    const result = await readIndexRooms(client as never, null, '/pull/spaces/sp-abc/objects/_index', 'sp-abc');
    expect(result).toBeNull();
  });

  it('returns rooms and categories for a plaintext index (enc=null)', async () => {
    const room = makeRoomNode(`sp-abc-general`);
    const data = { objects: [room] };
    const client = makeClient({ pull: vi.fn().mockResolvedValue({ data, hash: null }) });
    const result = await readIndexRooms(client as never, null, '/pull/spaces/sp-abc/objects/_index', 'sp-abc');
    expect(result).not.toBeNull();
    expect(result!.rooms.length).toBeGreaterThan(0);
    expect(result!.rooms[0]!.id).toBe('sp-abc-general');
  });

  it('uses the encryptor to decrypt when provided', async () => {
    const room = makeRoomNode('sp-abc-general');
    const data = { objects: [room] };
    const encryptor = { decrypt: vi.fn().mockResolvedValue(data) };
    const client = makeClient({ pull: vi.fn().mockResolvedValue({ data: { sealed: 'xxx' }, hash: null }) });
    await readIndexRooms(client as never, encryptor as never, '/pull/...', 'sp-abc');
    expect(encryptor.decrypt).toHaveBeenCalledOnce();
  });

  it('returns null on any thrown error (graceful degradation)', async () => {
    const client = makeClient({ pull: vi.fn().mockRejectedValue(new Error('network')) });
    const result = await readIndexRooms(client as never, null, '/pull/...', 'sp-abc');
    expect(result).toBeNull();
  });
});

// ── pushIndexSeed ─────────────────────────────────────────────────────────────

describe('pushIndexSeed', () => {
  it('does NOT push when the index already exists (idempotent)', async () => {
    const client = makeClient({
      pull: vi.fn().mockResolvedValue({ data: { objects: [] }, hash: 'h1' }),
      push: vi.fn(),
    });
    await pushIndexSeed(client as never, 'sp-abc', [{ id: 'sp-abc-general', name: 'general', kind: 'channel', category: 'Channels', enc: true }]);
    expect(client.push).not.toHaveBeenCalled();
  });

  it('pushes a seed doc when the index is absent (creates 1 category + 1 room node)', async () => {
    const client = makeClient({
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    });
    await pushIndexSeed(client as never, 'sp-abc', [{ id: 'sp-abc-general', name: 'general', kind: 'channel', category: 'Channels', enc: true }]);
    expect(client.push).toHaveBeenCalledOnce();
    const [, doc] = vi.mocked(client.push).mock.calls[0]!;
    const pushed = doc as { objects: Array<{ type: string; enc?: boolean }> };
    // seedIndexNodes produces one category node + one room node
    expect(pushed.objects).toHaveLength(2);
    const roomNode = pushed.objects.find((n) => n.type === 'room');
    expect(roomNode).toBeDefined();
    expect(roomNode!.enc).toBe(true);
  });
});

// ── seedSpaceObjectIndex ──────────────────────────────────────────────────────

describe('seedSpaceObjectIndex', () => {
  it('obtains a space client and delegates to pushIndexSeed', async () => {
    const fakeClient = makeClient({
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(getSpaceClient).mockReturnValue(fakeClient as never);
    const session = makeSession();
    await seedSpaceObjectIndex(session, 'sp-abc', [{ id: 'sp-abc-general', name: 'general', kind: 'channel', category: 'Channels', enc: true }]);
    expect(getSpaceClient).toHaveBeenCalledWith('sp-abc', session);
    expect(fakeClient.push).toHaveBeenCalledOnce();
  });
});

// ── readPrivateSpaceRooms ─────────────────────────────────────────────────────

describe('readPrivateSpaceRooms', () => {
  it('returns [] on any error (graceful degradation)', async () => {
    vi.mocked(getSpaceClient).mockImplementation(() => { throw new Error('no access'); });
    const session = makeSession();
    const rooms = await readPrivateSpaceRooms(session, 'sp-abc');
    expect(rooms).toEqual([]);
  });

  it('returns [] when the index is empty', async () => {
    const fakeClient = makeClient({
      pull: vi.fn().mockResolvedValue({ data: { objects: [] }, hash: null }),
    });
    vi.mocked(getSpaceClient).mockReturnValue(fakeClient as never);
    const session = makeSession();
    const rooms = await readPrivateSpaceRooms(session, 'sp-abc');
    expect(rooms).toEqual([]);
  });
});
