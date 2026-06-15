/**
 * Tests for OctoChat space membership helpers.
 * Focus on the pure-logic paths and validation guards that don't require a live
 * keyring/server, mocking at the boundary of the heavy crypto dependencies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock('@drakkar.software/starfish-keyring', () => ({
  addCollectionRecipient: vi.fn(),
}));

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn(),
}));

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/octospaces-sdk')>();
  return {
    ...actual,
    getSpaceAccessEntry: vi.fn(),
    saveSpaceAccessEntry: vi.fn(),
  };
});

vi.mock('./client', () => ({
  buildEncryptor: vi.fn(),
  makeClient: vi.fn(),
}));

vi.mock('./registry', () => ({
  addSpaceMember: vi.fn(),
  addJoinedSpaceWithCap: vi.fn(),
  readSpaces: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import { saveSpaceAccessEntry } from '@drakkar.software/octospaces-sdk';
import { buildEncryptor, makeClient } from './client';
import { addSpaceMember, addJoinedSpaceWithCap, readSpaces } from './registry';

import {
  makeJoinRequest,
  inviteToSpace,
  acceptSpaceInvite,
  addDeviceToSpaceKeyring,
  type JoinRequest,
} from './members';
import type { Session } from './identity';

// ── Shared test fixtures ──────────────────────────────────────────────────────

function makeSession(overrides?: Partial<Session>): Session {
  return {
    userId: 'u-owner',
    keys: {
      edPub: 'edpub-owner',
      edPriv: 'edpriv-owner',
      kemPub: 'kempub-owner',
      kemPriv: 'kempriv-owner',
    },
    chatClient: {} as never,
    accountClient: {} as never,
    spacesRegistryClient: {} as never,
    ...overrides,
  } as Session;
}

const INVITEE_REQUEST: JoinRequest = {
  edPub: 'edpub-invitee',
  kemPub: 'kempub-invitee',
  userId: 'u-invitee',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addCollectionRecipient).mockResolvedValue(undefined as never);
  vi.mocked(mintMemberCap).mockResolvedValue('{"kind":"member","sub":"edpub-invitee"}' as never);
  vi.mocked(addSpaceMember).mockResolvedValue(undefined);
  vi.mocked(addJoinedSpaceWithCap).mockResolvedValue(undefined);
  vi.mocked(readSpaces).mockResolvedValue({ spaces: [{ id: 'sp-abc', name: 'Test Space', short: 'TE', members: 1 }], hash: null } as never);
  vi.mocked(makeClient).mockReturnValue({} as never);
  vi.mocked(buildEncryptor).mockResolvedValue({ decrypt: vi.fn() } as never);
});

// ── makeJoinRequest ───────────────────────────────────────────────────────────

describe('makeJoinRequest', () => {
  it('serializes the session identity to a JSON join request', () => {
    const session = makeSession();
    const json = makeJoinRequest(session);
    const parsed = JSON.parse(json) as JoinRequest;
    expect(parsed.edPub).toBe('edpub-owner');
    expect(parsed.kemPub).toBe('kempub-owner');
    expect(parsed.userId).toBe('u-owner');
  });
});

// ── addDeviceToSpaceKeyring ───────────────────────────────────────────────────

describe('addDeviceToSpaceKeyring', () => {
  it('calls addCollectionRecipient with the correct keyring name and recipient', async () => {
    const session = makeSession();
    await addDeviceToSpaceKeyring(session, 'sp-abc', { kemPub: 'kempub-device', userId: 'u-device' });
    expect(addCollectionRecipient).toHaveBeenCalledOnce();
    const [, collectionName, recipient] = vi.mocked(addCollectionRecipient).mock.calls[0]!;
    expect(collectionName).toBe('spaces/sp-abc'); // keyringName(spaceId)
    expect((recipient as { subKem: string }).subKem).toBe('kempub-device');
  });

  it('swallows "already present in epoch" error (idempotent re-invite)', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValueOnce(
      new Error('Recipient kempub already present in epoch 1'),
    );
    const session = makeSession();
    await expect(addDeviceToSpaceKeyring(session, 'sp-abc', { kemPub: 'kempub-x', userId: 'u-x' })).resolves.toBeUndefined();
  });

  it('re-throws other errors', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValueOnce(new Error('network failure'));
    const session = makeSession();
    await expect(addDeviceToSpaceKeyring(session, 'sp-abc', { kemPub: 'kempub-x', userId: 'u-x' })).rejects.toThrow('network failure');
  });
});

// ── inviteToSpace ─────────────────────────────────────────────────────────────

describe('inviteToSpace', () => {
  it('rejects a request missing required fields', async () => {
    const session = makeSession();
    await expect(inviteToSpace(session, 'sp-abc', JSON.stringify({ edPub: 'a' }))).rejects.toThrow('valid join request');
  });

  it('adds the invitee to the keyring, roster, and mints a cap', async () => {
    const session = makeSession();
    await inviteToSpace(session, 'sp-abc', JSON.stringify(INVITEE_REQUEST), true, 'My Space');
    expect(addCollectionRecipient).toHaveBeenCalledOnce(); // keyring
    expect(addSpaceMember).toHaveBeenCalledWith(session.accountClient, 'sp-abc', 'u-owner', 'u-invitee');
    expect(mintMemberCap).toHaveBeenCalledOnce();
  });

  it('returns a JSON string containing spaceId, spaceName, and cap', async () => {
    const session = makeSession();
    const result = await inviteToSpace(session, 'sp-abc', JSON.stringify(INVITEE_REQUEST), true, 'My Space');
    const parsed = JSON.parse(result) as { spaceId: string; spaceName: string; cap: unknown };
    expect(parsed.spaceId).toBe('sp-abc');
    expect(parsed.spaceName).toBe('My Space');
    expect(parsed.cap).toBeDefined();
  });

  it('falls back to readSpaces for the name when spaceName is not provided', async () => {
    const session = makeSession();
    await inviteToSpace(session, 'sp-abc', JSON.stringify(INVITEE_REQUEST), true);
    expect(readSpaces).toHaveBeenCalledOnce();
    const result = await inviteToSpace(session, 'sp-abc', JSON.stringify(INVITEE_REQUEST), true);
    const parsed = JSON.parse(result) as { spaceName: string };
    expect(parsed.spaceName).toBe('Test Space');
  });
});

// ── acceptSpaceInvite ─────────────────────────────────────────────────────────

describe('acceptSpaceInvite', () => {
  function makeInviteJson(overrides?: Record<string, unknown>): string {
    return JSON.stringify({
      spaceId: 'sp-abc',
      spaceName: 'Test Space',
      cap: { kind: 'member', sub: 'edpub-invitee', iss: 'edpub-owner' },
      ...overrides,
    });
  }

  function makeInviteeSession(): Session {
    return makeSession({ userId: 'u-invitee', keys: { edPub: 'edpub-invitee', edPriv: 'edpriv-invitee', kemPub: 'kempub-invitee', kemPriv: 'kempriv-invitee' } as never });
  }

  it('rejects an invite with a missing spaceId', async () => {
    const session = makeInviteeSession();
    await expect(acceptSpaceInvite(session, JSON.stringify({ cap: { kind: 'member', sub: 'edpub-invitee', iss: 'x' } }))).rejects.toThrow('not a valid space invite');
  });

  it('rejects an invite with cap.kind !== "member"', async () => {
    const session = makeInviteeSession();
    await expect(acceptSpaceInvite(session, makeInviteJson({ cap: { kind: 'link', sub: 'edpub-invitee', iss: 'x' } }))).rejects.toThrow('not a valid space invite');
  });

  it('rejects an invite bound to a different identity (sub mismatch)', async () => {
    const session = makeInviteeSession();
    await expect(acceptSpaceInvite(session, makeInviteJson({ cap: { kind: 'member', sub: 'edpub-OTHER', iss: 'x' } }))).rejects.toThrow('different identity');
  });

  it('rejects an invite missing an issuer', async () => {
    const session = makeInviteeSession();
    await expect(acceptSpaceInvite(session, makeInviteJson({ cap: { kind: 'member', sub: 'edpub-invitee' } }))).rejects.toThrow('missing its issuer');
  });

  it('rejects when the invitee is not in the keyring (buildEncryptor returns null)', async () => {
    vi.mocked(buildEncryptor).mockResolvedValueOnce(null);
    const session = makeInviteeSession();
    await expect(acceptSpaceInvite(session, makeInviteJson())).rejects.toThrow('not in the space keyring');
  });

  it('accepts a valid invite: persists the space + cap and saves the access entry', async () => {
    const callOrder: string[] = [];
    vi.mocked(addJoinedSpaceWithCap).mockImplementationOnce(async () => { callOrder.push('addJoinedSpaceWithCap'); });
    vi.mocked(saveSpaceAccessEntry).mockImplementationOnce(() => { callOrder.push('saveSpaceAccessEntry'); });
    const session = makeInviteeSession();
    const space = await acceptSpaceInvite(session, makeInviteJson());
    expect(space.id).toBe('sp-abc');
    expect(space.name).toBe('Test Space');
    expect(saveSpaceAccessEntry).toHaveBeenCalledWith('sp-abc', expect.objectContaining({ kind: 'member' }));
    // addJoinedSpaceWithCap must be called BEFORE saveSpaceAccessEntry (crash-safety: server-side persist first)
    expect(callOrder).toEqual(['addJoinedSpaceWithCap', 'saveSpaceAccessEntry']);
  });
});
