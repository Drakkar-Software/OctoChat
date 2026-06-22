/**
 * Unit tests for batchPullSpaceData (batch-space.ts).
 *
 * Covers:
 * - Batch happy path: both collections return data → registry + index parsed correctly
 * - Missing registry data: entry undefined / null data → owner/members/hash null, empty members
 * - Missing index data: objindex entry undefined / no objects → index null
 * - Index with rooms: rooms + categories projected from ObjectNodes
 * - Fallback path: batchPull throws → falls back to readSpaceAccess + readIndexRooms in parallel
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockBatchPull = vi.fn();
const mockGetSpaceClient = vi.fn(() => ({ batchPull: mockBatchPull }));
const mockReadSpaceAccess = vi.fn();

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getSpaceClient: (...args: unknown[]) => mockGetSpaceClient(...args),
    readSpaceAccess: (...args: unknown[]) => mockReadSpaceAccess(...args),
  };
});

const mockReadIndexRooms = vi.fn();
vi.mock('./object-index', () => ({
  readIndexRooms: (...args: unknown[]) => mockReadIndexRooms(...args),
}));

import { batchPullSpaceData } from './batch-space';
import type { Session } from './identity';

const SESSION = { userId: 'u1' } as unknown as Session;
const SPACE_ID = 'sp-test';

function makeBatchResult(regData: Record<string, unknown> | null, regHash: string | null, idxData: Record<string, unknown> | null) {
  return {
    collections: {
      spaceregistry: [{ data: regData, hash: regHash, ts: 1000 }],
      objindex: idxData !== null ? [{ data: idxData, hash: 'ih1', ts: 1001 }] : [],
    },
  };
}

beforeEach(() => {
  mockBatchPull.mockReset();
  mockGetSpaceClient.mockReset();
  mockReadSpaceAccess.mockReset();
  mockReadIndexRooms.mockReset();
  mockGetSpaceClient.mockReturnValue({ batchPull: mockBatchPull });
});

// ── Batch happy path ───────────────────────────────────────────────────────────

describe('batchPullSpaceData — batch happy path', () => {
  it('parses registry fields from spaceregistry entry', async () => {
    mockBatchPull.mockResolvedValue(
      makeBatchResult({ owner: 'alice', members: ['bob', 'carol'], name: 'Test Space', image: 'img.png' }, 'rh1', null),
    );
    const { registry } = await batchPullSpaceData(SESSION, SPACE_ID);
    expect(registry.owner).toBe('alice');
    expect(registry.members).toEqual(['bob', 'carol']);
    expect(registry.name).toBe('Test Space');
    expect(registry.image).toBe('img.png');
    expect(registry.hash).toBe('rh1');
  });

  it('parses index rooms from objindex entry with ObjectNodes', async () => {
    // ObjectNode uses title (not name), type:'room' (not 'channel'), parentId (not category)
    const objects = [
      { id: 'cat1', type: 'category', title: 'Channels', parentId: null, order: 0, updatedAt: 0 },
      { id: 'sp-test-general', type: 'room', title: 'general', parentId: 'cat1', order: 1, access: 'space', enc: false, updatedAt: 0 },
    ];
    mockBatchPull.mockResolvedValue(
      makeBatchResult({ owner: 'alice', members: [], name: null, image: null }, 'rh1', { objects }),
    );
    const { index } = await batchPullSpaceData(SESSION, SPACE_ID);
    expect(index).not.toBeNull();
    expect(index!.categories).toContain('Channels');
    expect(index!.rooms).toHaveLength(1);
    const room = index!.rooms[0] as { id: string };
    expect(room.id).toBe('sp-test-general');
  });

  it('uses getSpaceClient with the correct session and spaceId', async () => {
    mockBatchPull.mockResolvedValue(makeBatchResult({ owner: 'u1', members: [], name: null, image: null }, 'h1', null));
    await batchPullSpaceData(SESSION, SPACE_ID);
    expect(mockGetSpaceClient).toHaveBeenCalledWith(SPACE_ID, SESSION);
  });

  it('passes correct collection names and params to batchPull', async () => {
    mockBatchPull.mockResolvedValue(makeBatchResult(null, null, null));
    await batchPullSpaceData(SESSION, SPACE_ID);
    expect(mockBatchPull).toHaveBeenCalledWith(
      ['spaceregistry', 'objindex'],
      expect.objectContaining({
        params: {
          spaceregistry: [{ spaceId: SPACE_ID }],
          objindex: [{ spaceId: SPACE_ID }],
        },
      }),
    );
  });
});

// ── Missing / partial data ─────────────────────────────────────────────────────

describe('batchPullSpaceData — missing data', () => {
  it('returns null owner/hash/members when registry data is null', async () => {
    mockBatchPull.mockResolvedValue(makeBatchResult(null, null, null));
    const { registry } = await batchPullSpaceData(SESSION, SPACE_ID);
    expect(registry.owner).toBeNull();
    expect(registry.hash).toBeNull();
    expect(registry.members).toEqual([]);
  });

  it('returns null index when objindex entry is missing', async () => {
    mockBatchPull.mockResolvedValue({
      collections: {
        spaceregistry: [{ data: { owner: 'u1', members: [] }, hash: 'h1', ts: 1 }],
        objindex: [],
      },
    });
    const { index } = await batchPullSpaceData(SESSION, SPACE_ID);
    expect(index).toBeNull();
  });

  it('returns null index when objindex data has no objects array', async () => {
    mockBatchPull.mockResolvedValue(
      makeBatchResult({ owner: 'u1', members: [] }, 'h1', { somethingElse: true }),
    );
    const { index } = await batchPullSpaceData(SESSION, SPACE_ID);
    // objectsToRoomCategories returns null when there are no room/category nodes
    expect(index).toBeNull();
  });

  it('filters non-string members from the members array', async () => {
    mockBatchPull.mockResolvedValue(
      makeBatchResult({ owner: 'u1', members: ['bob', 42, null, 'carol'] }, 'h1', null),
    );
    const { registry } = await batchPullSpaceData(SESSION, SPACE_ID);
    expect(registry.members).toEqual(['bob', 'carol']);
  });
});

// ── Fallback path ──────────────────────────────────────────────────────────────

describe('batchPullSpaceData — fallback on batchPull error', () => {
  it('falls back to readSpaceAccess + readIndexRooms when batchPull throws', async () => {
    mockBatchPull.mockRejectedValue(new Error('batch not supported'));
    mockReadSpaceAccess.mockResolvedValue({ owner: 'alice', members: ['bob'], name: 'Space', image: null, hash: 'fh1' });
    mockReadIndexRooms.mockResolvedValue({ rooms: [], categories: [] });

    const { registry, index } = await batchPullSpaceData(SESSION, SPACE_ID);

    expect(registry.owner).toBe('alice');
    expect(registry.hash).toBe('fh1');
    expect(index).toEqual({ rooms: [], categories: [] });
    expect(mockReadSpaceAccess).toHaveBeenCalledTimes(1);
    expect(mockReadIndexRooms).toHaveBeenCalledTimes(1);
  });

  it('fallback fires readSpaceAccess and readIndexRooms concurrently (both called)', async () => {
    mockBatchPull.mockRejectedValue(new Error('network error'));
    let accessResolved = false;
    let idxStarted = false;
    mockReadSpaceAccess.mockImplementation(async () => {
      // Simulate slight delay; readIndexRooms should also have been started (concurrently)
      await new Promise((r) => setTimeout(r, 5));
      accessResolved = true;
      return { owner: 'u1', members: [], name: null, image: null, hash: null };
    });
    mockReadIndexRooms.mockImplementation(async () => {
      idxStarted = true;
      return null;
    });

    await batchPullSpaceData(SESSION, SPACE_ID);

    expect(accessResolved).toBe(true);
    expect(idxStarted).toBe(true);
    expect(mockReadSpaceAccess).toHaveBeenCalledTimes(1);
    expect(mockReadIndexRooms).toHaveBeenCalledTimes(1);
  });

  it('fallback returns index null when readIndexRooms returns null', async () => {
    mockBatchPull.mockRejectedValue(new Error('error'));
    mockReadSpaceAccess.mockResolvedValue({ owner: null, members: [], name: null, image: null, hash: null });
    mockReadIndexRooms.mockResolvedValue(null);

    const { index } = await batchPullSpaceData(SESSION, SPACE_ID);
    expect(index).toBeNull();
  });
});
