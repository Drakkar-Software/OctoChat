/**
 * Tests for OctoChat-specific registry functions.
 *
 * All space list / caps / access-record functions (readSpaces, updateSpacesDoc,
 * readSpaceAccess, writeSpaceAccess, etc.) are now thin re-exports from
 * @drakkar.software/starfish-spaces, which has its own test suite. This file
 * only tests OctoChat-specific behavior: createSpace (keyring mint + seed order).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub starfish-spaces — we need to intercept ownerEnsureKeyring and the registry
// functions that createSpace imports and calls.
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    ownerEnsureKeyring: vi.fn().mockResolvedValue({}),
    readSpaces: vi.fn().mockResolvedValue({ spaces: [], caps: {}, dms: {}, hash: 'h-spaces' }),
    writeSpaceAccess: vi.fn().mockResolvedValue(undefined),
    writeSpaces: vi.fn().mockResolvedValue(undefined),
  };
});

// Stub path helpers so paths.ts doesn't pull in expo runtime config.
vi.mock('./paths', () => ({
  keyringPull: (s: string) => `/pull/spaces/${s}/_keyring`,
  keyringPush: (s: string) => `/push/spaces/${s}/_keyring`,
}));

vi.mock('./identity', () => ({
  ownerTrustedAdders: vi.fn().mockReturnValue(['owner-ed-pub']),
}));

vi.mock('./object-index', () => ({
  seedSpaceObjectIndex: vi.fn().mockResolvedValue(undefined),
}));

import { ownerEnsureKeyring, readSpaces as readSpacesCore, writeSpaceAccess, writeSpaces } from '@drakkar.software/starfish-spaces';
import { makeMockSession } from '../test-utils/mock-session';
import { seedSpaceObjectIndex } from './object-index';
import { createSpace } from './registry';

// ── createSpace regression tests ──────────────────────────────────────────────
//
// These tests pin the keyring-mint invariant added in Fix A:
//   createSpace must call ownerEnsureKeyring AFTER writeSpaceAccess (TOFU)
//   and BEFORE seedSpaceObjectIndex (crash-safety: failed seed leaves orphan,
//   not an empty listed space with no keyring).

describe('createSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ownerEnsureKeyring).mockResolvedValue({} as never);
    vi.mocked(readSpacesCore).mockResolvedValue({ spaces: [], caps: {}, dms: {}, hash: 'h-spaces' } as never);
    vi.mocked(writeSpaceAccess).mockResolvedValue(undefined);
    vi.mocked(writeSpaces).mockResolvedValue(undefined);
    vi.mocked(seedSpaceObjectIndex).mockResolvedValue(undefined);
  });

  it('returns a Space with id, name, short, and members:1', async () => {
    const space = await createSpace(makeMockSession({ userId: 'alice' }), 'My Test Space');
    expect(space).toMatchObject({ name: 'My Test Space', members: 1 });
    expect(typeof space.id).toBe('string');
    expect(space.id.startsWith('sp-')).toBe(true);
  });

  it('trims the name and defaults to "New Space" when blank', async () => {
    const space = await createSpace(makeMockSession({ userId: 'alice' }), '   ');
    expect(space.name).toBe('New Space');
  });

  it('FIX A: calls ownerEnsureKeyring to mint the space keyring on createSpace', async () => {
    const session = makeMockSession({ userId: 'alice' });
    await createSpace(session, 'Enc Space');
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledTimes(1);
    // Signature: (client, keys, pullPath, pushPath, trustedAdders)
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledWith(
      session.contentClient,
      session.keys,
      expect.stringContaining('_keyring'),
      expect.stringContaining('_keyring'),
      expect.any(Array),
    );
  });

  it('FIX A: writeSpaceAccess is called BEFORE ownerEnsureKeyring (TOFU gate)', async () => {
    const callOrder: string[] = [];
    vi.mocked(writeSpaceAccess).mockImplementation(async () => { callOrder.push('writeSpaceAccess'); });
    vi.mocked(ownerEnsureKeyring).mockImplementation(async () => { callOrder.push('ownerEnsureKeyring'); return {} as never; });
    vi.mocked(seedSpaceObjectIndex).mockImplementation(async () => { callOrder.push('seedSpaceObjectIndex'); });
    await createSpace(makeMockSession({ userId: 'alice' }), 'Order Test');
    expect(callOrder).toEqual(['writeSpaceAccess', 'ownerEnsureKeyring', 'seedSpaceObjectIndex']);
  });

  it('seeds the object index with a general channel that has enc:true', async () => {
    await createSpace(makeMockSession({ userId: 'alice' }), 'Enc Space');
    expect(vi.mocked(seedSpaceObjectIndex)).toHaveBeenCalledTimes(1);
    const [, , nodes] = vi.mocked(seedSpaceObjectIndex).mock.calls[0] as [unknown, string, Array<{ name: string; enc?: boolean }>];
    const general = nodes.find((n) => n.name === 'general');
    expect(general).toBeDefined();
    expect(general?.enc).toBe(true);
  });

  it('propagates a keyring-mint failure without calling writeSpaces (crash-safety)', async () => {
    vi.mocked(ownerEnsureKeyring).mockRejectedValueOnce(new Error('keyring write failed'));
    await expect(createSpace(makeMockSession({ userId: 'alice' }), 'Bad Space')).rejects.toThrow('keyring write failed');
    expect(vi.mocked(writeSpaces)).not.toHaveBeenCalled();
  });

  it('idempotent: ownerEnsureKeyring is called for each createSpace invocation', async () => {
    const session = makeMockSession({ userId: 'alice' });
    vi.mocked(readSpacesCore).mockResolvedValue({ spaces: [], caps: {}, dms: {}, hash: null } as never);
    await createSpace(session, 'Space One');
    await createSpace(session, 'Space Two');
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledTimes(2);
  });
});
