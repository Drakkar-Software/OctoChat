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
  roomsRegistryPull: (s: string) => `/pull/rooms/${s}`,
  roomsRegistryPush: (s: string) => `/push/rooms/${s}`,
}));

import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';

import { addJoinedSpaceWithCap, readSpaces, updateSpacesDoc } from './registry';

/** A fake StarfishClient exposing just pull/push. */
function fakeClient(pull: ReturnType<typeof vi.fn>, push: ReturnType<typeof vi.fn>) {
  return { pull, push } as never;
}

const SPACE = (id: string) => ({ id, name: id, short: id.slice(0, 2), members: 1 }) as never;

describe('updateSpacesDoc', () => {
  it('preserves the caps map when the mutator only changes spaces', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: { x: '1' } }, hash: 'h1' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: [...cur.spaces, SPACE('b')],
      caps: cur.caps,
    }));
    expect(push).toHaveBeenCalledWith('/push/u', { v: 1, spaces: [{ id: 'a' }, SPACE('b')], caps: { x: '1' } }, 'h1');
  });

  it('preserves the spaces array when the mutator only changes caps', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: { x: '1' } }, hash: 'h1' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, y: '2' },
    }));
    expect(push).toHaveBeenCalledWith('/push/u', { v: 1, spaces: [{ id: 'a' }], caps: { x: '1', y: '2' } }, 'h1');
  });

  it('retries on ConflictError by re-reading and re-applying', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {} }, hash: 'h' }));
    const push = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError())
      .mockResolvedValueOnce(undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({ spaces: cur.spaces, caps: { ...cur.caps, a: '1' } }));
    expect(pull).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('skips the write when the mutator returns the doc unchanged', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: {} }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => cur); // no-op (e.g. already joined)
    expect(push).not.toHaveBeenCalled();
  });

  it('treats a 404 as an empty doc and creates it (null baseHash)', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(404, '');
    });
    const push = vi.fn(async () => undefined);
    await updateSpacesDoc(fakeClient(pull, push), 'u', (cur) => ({ spaces: cur.spaces, caps: { ...cur.caps, a: '1' } }));
    expect(push).toHaveBeenCalledWith('/push/u', { v: 1, spaces: [], caps: { a: '1' } }, null);
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
    expect(push).toHaveBeenCalledWith('/push/u', { v: 1, spaces: [{ id: 'a' }], caps: { a: 'CAP' } }, 'h');
  });

  it('appends a new space and sets its cap', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }], caps: { a: 'CA' } }, hash: 'h' }));
    const push = vi.fn(async () => undefined);
    await addJoinedSpaceWithCap(fakeClient(pull, push), 'u', SPACE('b'), 'CB');
    expect(push).toHaveBeenCalledWith('/push/u', { v: 1, spaces: [{ id: 'a' }, SPACE('b')], caps: { a: 'CA', b: 'CB' } }, 'h');
  });
});

describe('readSpaces', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults caps to {} for a legacy doc with no caps key', async () => {
    const pull = vi.fn(async () => ({ data: { v: 1, spaces: [{ id: 'a' }] }, hash: 'h' }));
    const res = await readSpaces(fakeClient(pull, vi.fn()), 'u');
    expect(res.caps).toEqual({});
    expect(res.spaces).toEqual([{ id: 'a' }]);
  });

  it('degrades to empty on an unreachable read (no throw)', async () => {
    const pull = vi.fn(async () => {
      throw new StarfishHttpError(500, 'down');
    });
    const res = await readSpaces(fakeClient(pull, vi.fn()), 'u');
    expect(res).toEqual({ spaces: [], caps: {}, hash: null });
  });
});
