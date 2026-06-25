/**
 * Unit tests for batchPullSpaceData and batchPullManySpaceData (batch-space.ts).
 *
 * Covers for batchPullSpaceData:
 * - Batch happy path: both collections return data → registry + index parsed correctly
 * - Missing registry data: entry undefined / null data → owner/members/hash null, empty members
 * - Missing index data: objindex entry undefined / no objects → index null
 * - Index with rooms: rooms + categories projected from ObjectNodes
 * - Fallback path: batchPull throws → falls back to readSpaceAccess + readIndexRooms in parallel
 *
 * Covers for batchPullManySpaceData:
 * - Empty input → empty Map, no request fired
 * - Multi-space happy path: results keyed by spaceId, aligned by index
 * - Per-entry error in batch response → that space omitted from result Map
 * - Chunking: >50 spaces → multiple batchPull calls (one per chunk)
 * - Non-429 error → falls back to per-space batchPullSpaceData
 * - 429 → rethrows (no fallback)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockBatchPull = vi.fn();
const mockGetSpaceClient = vi.fn(() => ({ batchPull: mockBatchPull }));
const mockReadSpaceAccess = vi.fn();

vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
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

import { StarfishHttpError } from '@drakkar.software/starfish-client';
import { batchPullSpaceData, batchPullManySpaceData } from './batch-space';
import { makeMockSession } from '../test-utils/mock-session';

const SESSION = makeMockSession({ userId: 'u1' });
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

// ── batchPullManySpaceData and batchPullManySpaceAccess ────────────────────────

// Mocks for session.spacesRegistryClient
const mockSpacesRegistryBatchPull = vi.fn();
const mockSpacesRegistryBatchPullMany = vi.fn();

function makeRegistrySession() {
  return makeMockSession({
    spacesRegistryClient: {
      batchPull: mockSpacesRegistryBatchPull,
      batchPullMany: mockSpacesRegistryBatchPullMany,
    } as unknown as ReturnType<typeof makeMockSession>['spacesRegistryClient'],
  });
}

function makeMultiBatchResult(spaces: Array<{ id: string; owner: string | null; regHash: string | null }>) {
  return {
    collections: {
      spaceregistry: spaces.map((s) => ({
        data: s.owner !== null ? { owner: s.owner, members: [], name: null, image: null } : null,
        hash: s.regHash,
        ts: 1000,
      })),
      objindex: spaces.map(() => ({ data: null, hash: null, ts: 1001 })),
    },
  };
}

function resetCrossBatchMocks() {
  mockSpacesRegistryBatchPull.mockReset();
  mockSpacesRegistryBatchPullMany.mockReset();
  mockBatchPull.mockReset();
  mockGetSpaceClient.mockReset();
  mockGetSpaceClient.mockReturnValue({ batchPull: mockBatchPull });
  mockReadSpaceAccess.mockReset();
  mockReadIndexRooms.mockReset();
}

// ── batchPullManySpaceData ─────────────────────────────────────────────────────

describe('batchPullManySpaceData', () => {
  beforeEach(resetCrossBatchMocks);

  it('returns an empty Map and makes no request when spaceIds is empty', async () => {
    const result = await batchPullManySpaceData(makeRegistrySession(), []);
    expect(result.size).toBe(0);
    expect(mockSpacesRegistryBatchPull).not.toHaveBeenCalled();
  });

  it('returns results keyed by spaceId for a multi-space batch', async () => {
    const ids = ['sp-A', 'sp-B', 'sp-C'];
    mockSpacesRegistryBatchPull.mockResolvedValue(
      makeMultiBatchResult([
        { id: 'sp-A', owner: 'alice', regHash: 'h1' },
        { id: 'sp-B', owner: 'bob', regHash: 'h2' },
        { id: 'sp-C', owner: 'carol', regHash: 'h3' },
      ]),
    );
    const result = await batchPullManySpaceData(makeRegistrySession(), ids);
    expect(result.size).toBe(3);
    expect(result.get('sp-A')!.registry.owner).toBe('alice');
    expect(result.get('sp-B')!.registry.owner).toBe('bob');
    expect(result.get('sp-C')!.registry.owner).toBe('carol');
  });

  it('aligns results by index (first id → first entry)', async () => {
    const ids = ['sp-X', 'sp-Y'];
    mockSpacesRegistryBatchPull.mockResolvedValue({
      collections: {
        spaceregistry: [
          { data: { owner: 'u-x', members: [], name: 'X Space', image: null }, hash: 'hx', ts: 1 },
          { data: { owner: 'u-y', members: [], name: 'Y Space', image: null }, hash: 'hy', ts: 1 },
        ],
        objindex: [{ data: null, hash: null, ts: 1 }, { data: null, hash: null, ts: 1 }],
      },
    });
    const result = await batchPullManySpaceData(makeRegistrySession(), ids);
    expect(result.get('sp-X')!.registry.name).toBe('X Space');
    expect(result.get('sp-Y')!.registry.name).toBe('Y Space');
  });

  it('omits spaces whose server entry has an error field', async () => {
    const ids = ['sp-ok', 'sp-err'];
    mockSpacesRegistryBatchPull.mockResolvedValue({
      collections: {
        spaceregistry: [
          { data: { owner: 'u1', members: [], name: null, image: null }, hash: 'h1', ts: 1 },
          { error: 'Forbidden', data: undefined, hash: undefined, ts: 0 },
        ],
        objindex: [
          { data: null, hash: null, ts: 1 },
          { error: 'Forbidden', data: undefined, hash: undefined, ts: 0 },
        ],
      },
    });
    const result = await batchPullManySpaceData(makeRegistrySession(), ids);
    expect(result.has('sp-ok')).toBe(true);
    expect(result.has('sp-err')).toBe(false);
  });

  it('splits >50 spaces into multiple chunks and issues one batchPull per chunk', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `sp-${i}`);
    const makeChunkResult = (chunkIds: string[]) => ({
      collections: {
        spaceregistry: chunkIds.map((id) => ({ data: { owner: id, members: [], name: null, image: null }, hash: id, ts: 1 })),
        objindex: chunkIds.map(() => ({ data: null, hash: null, ts: 1 })),
      },
    });
    mockSpacesRegistryBatchPull
      .mockResolvedValueOnce(makeChunkResult(ids.slice(0, 50)))
      .mockResolvedValueOnce(makeChunkResult(ids.slice(50)));

    const result = await batchPullManySpaceData(makeRegistrySession(), ids);

    expect(mockSpacesRegistryBatchPull).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(60);
    expect(result.has('sp-0')).toBe(true);
    expect(result.has('sp-59')).toBe(true);
  });

  it('chunk batchPull passes correct params for the chunk space ids', async () => {
    const ids = ['sp-1', 'sp-2'];
    mockSpacesRegistryBatchPull.mockResolvedValue(makeMultiBatchResult([
      { id: 'sp-1', owner: 'u1', regHash: 'h1' },
      { id: 'sp-2', owner: 'u2', regHash: 'h2' },
    ]));
    await batchPullManySpaceData(makeRegistrySession(), ids);
    expect(mockSpacesRegistryBatchPull).toHaveBeenCalledWith(
      ['spaceregistry', 'objindex'],
      expect.objectContaining({
        params: {
          spaceregistry: [{ spaceId: 'sp-1' }, { spaceId: 'sp-2' }],
          objindex: [{ spaceId: 'sp-1' }, { spaceId: 'sp-2' }],
        },
      }),
    );
  });

  it('falls back to per-space batchPullSpaceData on a non-429 error', async () => {
    const ids = ['sp-A', 'sp-B'];
    mockSpacesRegistryBatchPull.mockRejectedValue(new Error('server error'));
    mockBatchPull
      .mockResolvedValueOnce(makeMultiBatchResult([{ id: 'sp-A', owner: 'alice', regHash: 'ha' }]))
      .mockResolvedValueOnce(makeMultiBatchResult([{ id: 'sp-B', owner: 'bob', regHash: 'hb' }]));

    const result = await batchPullManySpaceData(makeRegistrySession(), ids);

    expect(mockGetSpaceClient).toHaveBeenCalledWith('sp-A', expect.anything());
    expect(mockGetSpaceClient).toHaveBeenCalledWith('sp-B', expect.anything());
    expect(result.has('sp-A')).toBe(true);
    expect(result.has('sp-B')).toBe(true);
  });

  it('rethrows on 429 without falling back to per-space calls', async () => {
    mockSpacesRegistryBatchPull.mockRejectedValue(new StarfishHttpError(429, 'rate limited'));
    await expect(batchPullManySpaceData(makeRegistrySession(), ['sp-A'])).rejects.toBeInstanceOf(StarfishHttpError);
    expect(mockGetSpaceClient).not.toHaveBeenCalled();
  });
});

// ── batchPullManySpaceAccess ───────────────────────────────────────────────────

import { batchPullManySpaceAccess } from './batch-space';

describe('batchPullManySpaceAccess', () => {
  beforeEach(resetCrossBatchMocks);

  it('returns an empty Map and makes no request when spaceIds is empty', async () => {
    const result = await batchPullManySpaceAccess(makeRegistrySession(), []);
    expect(result.size).toBe(0);
    expect(mockSpacesRegistryBatchPullMany).not.toHaveBeenCalled();
  });

  it('calls batchPullMany("spaceregistry", …) on spacesRegistryClient', async () => {
    mockSpacesRegistryBatchPullMany.mockResolvedValue([
      { data: { owner: 'alice', members: ['bob'], name: 'A', image: null }, hash: 'h1', ts: 1 },
    ]);
    await batchPullManySpaceAccess(makeRegistrySession(), ['sp-A']);
    expect(mockSpacesRegistryBatchPullMany).toHaveBeenCalledWith(
      'spaceregistry',
      [{ spaceId: 'sp-A' }],
    );
  });

  it('returns results keyed by spaceId, owner/members parsed correctly', async () => {
    mockSpacesRegistryBatchPullMany.mockResolvedValue([
      { data: { owner: 'alice', members: ['bob'], name: 'A', image: null }, hash: 'h1', ts: 1 },
      { data: { owner: 'carol', members: [], name: 'C', image: null }, hash: 'h2', ts: 1 },
    ]);
    const result = await batchPullManySpaceAccess(makeRegistrySession(), ['sp-A', 'sp-C']);
    expect(result.get('sp-A')!.owner).toBe('alice');
    expect(result.get('sp-A')!.members).toEqual(['bob']);
    expect(result.get('sp-C')!.owner).toBe('carol');
  });

  it('omits entries with an error field', async () => {
    mockSpacesRegistryBatchPullMany.mockResolvedValue([
      { data: { owner: 'alice', members: [], name: null, image: null }, hash: 'h1', ts: 1 },
      { error: 'Forbidden', data: undefined, hash: undefined, ts: 0 },
    ]);
    const result = await batchPullManySpaceAccess(makeRegistrySession(), ['sp-ok', 'sp-err']);
    expect(result.has('sp-ok')).toBe(true);
    expect(result.has('sp-err')).toBe(false);
  });

  it('returns an empty Map on non-429 error (graceful degradation)', async () => {
    mockSpacesRegistryBatchPullMany.mockRejectedValue(new Error('network error'));
    const result = await batchPullManySpaceAccess(makeRegistrySession(), ['sp-A']);
    expect(result.size).toBe(0);
  });

  it('rethrows on 429', async () => {
    mockSpacesRegistryBatchPullMany.mockRejectedValue(new StarfishHttpError(429, 'rate limited'));
    await expect(batchPullManySpaceAccess(makeRegistrySession(), ['sp-A'])).rejects.toBeInstanceOf(StarfishHttpError);
  });
});
