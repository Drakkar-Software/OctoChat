import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK so ConflictError/StarfishHttpError are simple classes — the SAME
// classes registry.ts uses for `instanceof` (one mocked module) and that this test
// constructs. Avoids loading the full client under Node.
vi.mock('@drakkar.software/starfish-client', () => {
  class ConflictError extends Error {}
  class StarfishHttpError extends Error {
    status: number;
    constructor(status: number, body = '') {
      super(body);
      this.status = status;
    }
  }
  return { ConflictError, StarfishHttpError };
});

// Mock path helpers so registry.ts doesn't pull in ./config (expo runtime).
vi.mock('./paths', () => ({
  spacesPull: (u: string) => `/pull/${u}`,
  spacesPush: (u: string) => `/push/${u}`,
  spaceRegistryPull: (s: string) => `/pull/spaces/${s}`,
  spaceRegistryPush: (s: string) => `/push/spaces/${s}`,
}));

// Needed by registry.ts imports transitively (paths.ts re-exports from octospaces-sdk).
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: vi.fn() };
});

import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';

import {
  addJoinedSpaceWithCap,
  readSpaceAccess,
  readSpaces,
  setDmMapping,
  updateDmsDoc,
  updateReadsDoc,
  updateSpacesDoc,
  writeSpaceAccess,
} from './registry';

/** A fake StarfishClient exposing just pull/push. */
function fakeClient(pull: ReturnType<typeof vi.fn>, push: ReturnType<typeof vi.fn>) {
  return { pull, push } as never;
}

const SPACE = (id: string) => ({ id, name: id, short: id.slice(0, 2), members: 1 }) as never;

// The funnel reads `mutes`/`reads`/`dms` fresh and threads them through every push.
const EMPTY_MUTES = { rooms: {}, spaces: {} };
const EMPTY_READS = { rooms: {} };

describe('updateSpacesDoc', () => {
  it('preserves the caps map when the mutator only changes spaces', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: { x: '1' } }, hash: 'h1' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: [...cur.spaces, SPACE('b')],
      caps: cur.caps,
    }));
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [{ id: 'a' }, SPACE('b')], caps: { x: '1' }, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: {}, quickReactions: [], archivedDms: {}, pubAccess: {} },
      'h1',
    );
  });

  it('preserves the spaces array when the mutator only changes caps', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: { x: '1' } }, hash: 'h1' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, y: '2' },
    }));
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [{ id: 'a' }], caps: { x: '1', y: '2' }, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: {}, quickReactions: [], archivedDms: {}, pubAccess: {} },
      'h1',
    );
  });

  it('retries on ConflictError by re-reading and re-applying', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {} }, hash: 'h' }));
    const push = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError())
      .mockResolvedValueOnce(undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, a: '1' },
    }));
    expect(pull).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('skips the write when the mutator returns the doc unchanged', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: {} }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => cur); // no-op
    expect(push).not.toHaveBeenCalled();
  });

  it('treats a 404 as an empty doc and creates it (null baseHash)', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(404, '');
    });
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, a: '1' },
    }));
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [], caps: { a: '1' }, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: {}, quickReactions: [], archivedDms: {}, pubAccess: {} },
      null,
    );
  });

  it('propagates a non-404 read error without writing', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(500, 'boom');
    });
    const push = vi.fn(async () => undefined);
    await expect(updateSpacesDoc(fakeClient(pull, push), 'u', (c) => c)).rejects.toBeInstanceOf(StarfishHttpError);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('addJoinedSpaceWithCap', () => {
  it('sets the cap and does not duplicate an already-joined space', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: {} }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await addJoinedSpaceWithCap(fakeClient(pull, push), 'u', SPACE('a'), 'CAP');
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [{ id: 'a' }], caps: { a: 'CAP' }, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: {}, quickReactions: [], archivedDms: {}, pubAccess: {} },
      'h',
    );
  });

  it('appends a new space and sets its cap', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: { a: 'CA' } }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await addJoinedSpaceWithCap(fakeClient(pull, push), 'u', SPACE('b'), 'CB');
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [{ id: 'a' }, SPACE('b')], caps: { a: 'CA', b: 'CB' }, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: {}, quickReactions: [], archivedDms: {}, pubAccess: {} },
      'h',
    );
  });
});

describe('updateReadsDoc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the next read marks while threading every sibling key through', async () => {
    const pull = vi.fn(async () => ({
      data: {
        v: 1,
        spaces: [{ id: 'a' }],
        caps: { a: 'CAP' },
        mutes: { rooms: { r1: true }, spaces: {} },
        reads: { rooms: { r1: 100 } },
        dms: {},
      },
      hash: 'h1',
    }));
    const push = vi.fn(async () => undefined);
    await updateReadsDoc(fakeClient(pull, push), 'u', (cur) => ({ rooms: { ...cur.rooms, r2: 200 } }));
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      {
        v: 1,
        spaces: [{ id: 'a' }],
        caps: { a: 'CAP' },
        mutes: { rooms: { r1: true }, spaces: {} },
        reads: { rooms: { r1: 100, r2: 200 } },
        dms: {},
        quickReactions: [],
        archivedDms: {},
        pubAccess: {},
      },
      'h1',
    );
  });

  it('skips the write when the mutator returns null (nothing newer)', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {}, reads: { rooms: { r1: 100 } } }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await updateReadsDoc(fakeClient(pull, push), 'u', () => null);
    expect(push).not.toHaveBeenCalled();
  });

  it('retries on ConflictError by re-reading the latest server marks', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {}, reads: { rooms: {} } }, hash: 'h' }));
    const push = vi.fn().mockRejectedValueOnce(new ConflictError()).mockResolvedValueOnce(undefined);
    await updateReadsDoc(fakeClient(pull, push), 'u', (cur) => ({ rooms: { ...cur.rooms, r1: 1 } }));
    expect(pull).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe('updateDmsDoc / setDmMapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the next dms map while threading every sibling key through', async () => {
    const pull = vi.fn(async () => ({
      data: {
        v: 1,
        spaces: [{ id: 'a' }],
        caps: { a: 'CAP' },
        mutes: { rooms: { r1: true }, spaces: {} },
        reads: { rooms: { r1: 100 } },
        dms: { peerA: 'dm-1' },
      },
      hash: 'h1',
    }));
    const push = vi.fn(async () => undefined);
    await updateDmsDoc(fakeClient(pull, push), 'u', (cur) => ({ ...cur, peerB: 'dm-2' }));
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      {
        v: 1,
        spaces: [{ id: 'a' }],
        caps: { a: 'CAP' },
        mutes: { rooms: { r1: true }, spaces: {} },
        reads: { rooms: { r1: 100 } },
        dms: { peerA: 'dm-1', peerB: 'dm-2' },
        quickReactions: [],
        archivedDms: {},
        pubAccess: {},
      },
      'h1',
    );
  });

  it('a spaces/caps edit preserves an existing dms map', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {}, dms: { p: 'dm-x' } }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, a: '1' },
    }));
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [], caps: { a: '1' }, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: { p: 'dm-x' }, quickReactions: [], archivedDms: {}, pubAccess: {} },
      'h',
    );
  });

  it('setDmMapping adds a peer→space entry', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {}, dms: {} }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await setDmMapping(fakeClient(pull, push), 'u', 'peerA', 'dm-1');
    expect(push).toHaveBeenCalledWith(
      '/push/u',
      { v: 1, spaces: [], caps: {}, mutes: EMPTY_MUTES, reads: EMPTY_READS, dms: { peerA: 'dm-1' }, quickReactions: [], archivedDms: {}, pubAccess: {} },
      'h',
    );
  });

  it('setDmMapping is a no-op (no write) when the peer already maps to that space', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {}, dms: { peerA: 'dm-1' } }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await setDmMapping(fakeClient(pull, push), 'u', 'peerA', 'dm-1');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('readSpaces', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults caps + dms to {} for a legacy doc with none of the keys', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }] }, hash: 'h' }));
    const res = await readSpaces(fakeClient(pull, vi.fn()), 'u');
    expect(res.caps).toEqual({});
    expect(res.dms).toEqual({});
    expect(res.quickReactions).toEqual([]);
    expect(res.spaces).toEqual([{ id: 'a' }]);
  });

  it('degrades to empty on an unreachable read (no throw)', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(500, 'down');
    });
    const res = await readSpaces(fakeClient(pull, vi.fn()), 'u');
    expect(res).toEqual({
      spaces: [],
      caps: {},
      mutes: { rooms: {}, spaces: {} },
      reads: { rooms: {} },
      dms: {},
      quickReactions: [],
      archivedDms: {},
      pubAccess: {},
      hash: null,
    });
  });
});

describe('pubAccess threading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('readSpaces parses pubAccess from the raw doc instead of dropping it', async () => {
    const blob = { entry: {}, ct: 'ABC' };
    const pull = vi.fn(async () => ({
      data: { v: 1, spaces: [], caps: {}, pubAccess: { 'sp-1': blob } },
      hash: 'h',
    }));
    const res = await readSpaces(fakeClient(pull, vi.fn()), 'u');
    expect(res.pubAccess).toEqual({ 'sp-1': blob });
  });

  it('readSpaces defaults pubAccess to {} for a legacy doc with no pubAccess key', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [] }, hash: 'h' }));
    const res = await readSpaces(fakeClient(pull, vi.fn()), 'u');
    expect(res.pubAccess).toEqual({});
  });

  it('updateSpacesDoc threads pubAccess through a caps-only mutation', async () => {
    const blob = { entry: {}, ct: 'ABC' };
    const pull = vi.fn(async () => ({
      data: { v: 1, spaces: [], caps: {}, pubAccess: { 'sp-1': blob } },
      hash: 'h',
    }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, a: '1' },
    }));
    const [, body] = push.mock.calls[0] as [string, Record<string, unknown>, string | null];
    expect(body.pubAccess).toEqual({ 'sp-1': blob });
  });

  it('updateSpacesDoc mutator can delete a pubAccess entry (leave scenario)', async () => {
    const blob = { entry: {}, ct: 'CRED' };
    const pull = vi.fn(async () => ({
      data: { v: 1, spaces: [{ id: 'sp-1' }], caps: { 'sp-1': 'cap' }, pubAccess: { 'sp-1': blob } },
      hash: 'h',
    }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => {
      const caps = { ...cur.caps };
      delete caps['sp-1'];
      const pubAccess = { ...cur.pubAccess };
      delete pubAccess['sp-1'];
      return { spaces: cur.spaces.filter((s) => s.id !== 'sp-1'), caps, pubAccess };
    });
    const [, body] = push.mock.calls[0] as [string, Record<string, unknown>, string | null];
    expect(body.pubAccess).toEqual({});
    expect((body.caps as Record<string, unknown>)['sp-1']).toBeUndefined();
  });
});

describe('readSpaceAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty registry on a 404 (no doc yet — a first write can create it)', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(404, '');
    });
    const res = await readSpaceAccess(fakeClient(pull, vi.fn()), 'sp-1');
    expect(res).toEqual({ owner: null, members: [], name: null, image: null, hash: null });
  });

  // The linchpin of the offline fix: a network failure must PROPAGATE (not collapse to
  // an empty registry), so the rooms provider can fall back to the cached list rather
  // than wiping it. Both a StarfishHttpError(5xx) and a plain network rejection throw.
  it('propagates a non-404 HTTP error instead of degrading to empty', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(500, 'down');
    });
    await expect(readSpaceAccess(fakeClient(pull, vi.fn()), 'sp-1')).rejects.toBeInstanceOf(StarfishHttpError);
  });

  it('propagates a plain network rejection (offline) instead of degrading to empty', async () => {
    const pull = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(readSpaceAccess(fakeClient(pull, vi.fn()), 'sp-1')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('writeSpaceAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes owner + members + optional name/image to spaces/{spaceId}/_access', async () => {
    const push = vi.fn(async () => undefined);
    await writeSpaceAccess(fakeClient(vi.fn(), push), 'sp-1', 'alice', ['bob', 'carol'], 'h0', {
      name: 'My Space',
      image: 'data:img',
    });
    expect(push).toHaveBeenCalledWith(
      '/push/spaces/sp-1',
      { v: 1, owner: 'alice', members: ['bob', 'carol'], name: 'My Space', image: 'data:img' },
      'h0',
    );
  });

  it('omits name and image when absent / falsy', async () => {
    const push = vi.fn(async () => undefined);
    await writeSpaceAccess(fakeClient(vi.fn(), push), 'sp-1', 'alice', [], null);
    const [, body] = push.mock.calls[0] as [string, Record<string, unknown>, string | null];
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('image');
  });

  it('creates a new doc (null hash) when no previous hash exists', async () => {
    const push = vi.fn(async () => undefined);
    await writeSpaceAccess(fakeClient(vi.fn(), push), 'sp-2', 'owner', [], null);
    expect(push.mock.calls[0]?.[2]).toBeNull();
  });
});
