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
  keyringPull: (s: string) => `/pull/spaces/${s}/_keyring`,
  keyringPush: (s: string) => `/push/spaces/${s}/_keyring`,
}));

// Needed by registry.ts imports transitively (paths.ts re-exports from octospaces-sdk).
// Also stubs ownerEnsureKeyring which registry.ts now imports from here directly.
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: vi.fn(), ownerEnsureKeyring: vi.fn().mockResolvedValue({}) };
});

vi.mock('./identity', () => ({
  ownerTrustedAdders: vi.fn().mockReturnValue(['owner-ed-pub']),
}));

vi.mock('./object-index', () => ({
  seedSpaceObjectIndex: vi.fn().mockResolvedValue(undefined),
}));

import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';

import {
  addJoinedSpaceWithCap,
  createSpace,
  readSpaceAccess,
  readSpaces,
  setDmMapping,
  updateDmsDoc,
  updateReadsDoc,
  updateSpacesDoc,
  writeSpaceAccess,
} from './registry';

import { ownerEnsureKeyring } from '@drakkar.software/octospaces-sdk';
import { seedSpaceObjectIndex } from './object-index';

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

// ── createSpace regression tests ───────────────────────────────────────────────
//
// These tests pin the keyring-mint invariant added in Fix A:
//   createSpace must call ownerEnsureKeyring AFTER writeSpaceAccess
//   (so space:owner role is held before the keyring write) and BEFORE
//   seedSpaceObjectIndex (so a failed seed leaves an orphan, not an empty
//   listed space with no keyring).
//
// The "general" channel seeded by default must have enc:true so it uses the
// space-wide keyring for E2EE.

describe('createSpace', () => {
  // Build a minimal Session mock for createSpace.
  function makeSession(userId = 'alice') {
    const accountPull = vi.fn(async () => ({ data: { v: 1, owner: null, members: [] }, hash: null }));
    const accountPush = vi.fn(async () => undefined);
    const spacesPullFn = vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {}, dms: {} }, hash: 'h-spaces' }));
    const spacesPushFn = vi.fn(async () => undefined);
    return {
      userId,
      accountClient: fakeClient(accountPull, accountPush),
      chatClient: fakeClient(vi.fn(), vi.fn()),
      spacesRegistryClient: fakeClient(spacesPullFn, spacesPushFn),
      keys: { edPub: 'ed-pub', edPriv: 'ed-priv', kemPub: 'kem-pub', kemPriv: 'kem-priv' },
      _spacesPull: spacesPullFn,
      _spacesPush: spacesPushFn,
      _accountPush: accountPush,
    } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to their default resolved values.
    vi.mocked(ownerEnsureKeyring).mockResolvedValue({} as never);
    vi.mocked(seedSpaceObjectIndex).mockResolvedValue(undefined);
  });

  it('returns a Space with id, name, short, and members:1', async () => {
    const session = makeSession();
    const space = await createSpace(session, 'My Test Space');
    expect(space).toMatchObject({ name: 'My Test Space', short: 'MY', members: 1 });
    expect(typeof space.id).toBe('string');
    expect(space.id.length).toBeGreaterThan(0);
  });

  it('trims the name and defaults to "New Space" when blank', async () => {
    const session = makeSession();
    const space = await createSpace(session, '   ');
    expect(space.name).toBe('New Space');
  });

  it('FIX A: calls ownerEnsureKeyring to mint the space keyring', async () => {
    const session = makeSession();
    await createSpace(session, 'Enc Space');
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledTimes(1);
    // Must be called on chatClient (not accountClient or spacesRegistryClient).
    // Signature: (client, keys, pullPath, pushPath, trustedAdders)
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledWith(
      (session as never as { chatClient: unknown }).chatClient,
      (session as never as { keys: unknown }).keys,
      expect.stringContaining('_keyring'),   // keyringPull(spaceId)
      expect.stringContaining('_keyring'),   // keyringPush(spaceId)
      expect.any(Array),                     // trustedAdders
    );
  });

  it('FIX A: writeSpaceAccess is called BEFORE ownerEnsureKeyring (TOFU gate)', async () => {
    const callOrder: string[] = [];
    const session = makeSession();
    // Spy on accountClient.push to track writeSpaceAccess
    const accountClient = (session as never as { accountClient: { push: ReturnType<typeof vi.fn> } }).accountClient;
    vi.spyOn(accountClient, 'push').mockImplementation(async (..._args: unknown[]) => {
      callOrder.push('writeSpaceAccess');
    });
    vi.mocked(ownerEnsureKeyring).mockImplementation(async () => {
      callOrder.push('ownerEnsureKeyring');
      return {} as never;
    });
    vi.mocked(seedSpaceObjectIndex).mockImplementation(async () => {
      callOrder.push('seedSpaceObjectIndex');
    });
    await createSpace(session, 'Order Test');
    expect(callOrder).toEqual(['writeSpaceAccess', 'ownerEnsureKeyring', 'seedSpaceObjectIndex']);
  });

  it('seeds the object index with a general channel that has enc:true', async () => {
    const session = makeSession();
    await createSpace(session, 'Enc Space');
    expect(vi.mocked(seedSpaceObjectIndex)).toHaveBeenCalledTimes(1);
    const [, , nodes] = vi.mocked(seedSpaceObjectIndex).mock.calls[0] as [unknown, string, Array<{ name: string; enc?: boolean }>];
    const general = nodes.find((n) => n.name === 'general');
    expect(general).toBeDefined();
    expect(general?.enc).toBe(true);
  });

  it('idempotent: ownerEnsureKeyring no-ops when keyring already exists', async () => {
    // ownerEnsureKeyring is idempotent by design (it pulls first); we just verify
    // createSpace calls it even if called a second time, and the mock handles it.
    const session = makeSession();
    vi.mocked(ownerEnsureKeyring).mockResolvedValue({} as never);
    await createSpace(session, 'Existing Keyring Space');
    await createSpace(session, 'Same Session Second Space');
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledTimes(2);
  });

  it('propagates a keyring-mint failure without adding the space to _spaces', async () => {
    const session = makeSession();
    vi.mocked(ownerEnsureKeyring).mockRejectedValueOnce(new Error('keyring write failed'));
    await expect(createSpace(session, 'Bad Space')).rejects.toThrow('keyring write failed');
    // _spaces push must NOT have been called (crash-safety: don't list a broken space)
    const spacesPush = (session as never as { _spacesPush: ReturnType<typeof vi.fn> })._spacesPush;
    expect(spacesPush).not.toHaveBeenCalled();
  });
});
