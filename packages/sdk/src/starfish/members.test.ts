/**
 * Tests for OctoChat-specific space membership behavior.
 *
 * `makeJoinRequest`, `inviteToSpace`, and `addDeviceToSpaceKeyring` are now re-exported
 * directly from @drakkar.software/octospaces-sdk and are tested in the SDK's own
 * members.test.ts / members.keyring.test.ts. Only the OctoChat-specific overrides are
 * tested here:
 *
 *  - makeJoinRequest   — parity smoke-test (pure JSON; trivial, no mocks needed)
 *  - acceptSpaceInvite — OctoChat-local: live keyring pre-check (buildEncryptor) +
 *                        spacesRegistryClient write path
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/octospaces-sdk')>();
  return {
    ...actual,
    // acceptSpaceInvite calls addJoinedSpaceWithCap from the SDK directly
    addJoinedSpaceWithCap: vi.fn(),
    saveSpaceAccessEntry: vi.fn(),
  };
});

vi.mock('./client', () => ({
  buildEncryptor: vi.fn(),
  makeClient: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { addJoinedSpaceWithCap, saveSpaceAccessEntry } from '@drakkar.software/octospaces-sdk';
import { buildEncryptor, makeClient } from './client';
import { makeJoinRequest, acceptSpaceInvite, type JoinRequest } from './members';
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addJoinedSpaceWithCap).mockResolvedValue(undefined);
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

  it('writes the joined space to session.spacesRegistryClient (not accountClient)', async () => {
    const session = makeInviteeSession();
    await acceptSpaceInvite(session, makeInviteJson());
    // OctoChat uses spacesRegistryClient; the SDK's generic acceptSpaceInvite uses accountClient.
    // This test pins the OctoChat-specific routing.
    expect(vi.mocked(addJoinedSpaceWithCap).mock.calls[0]![0]).toBe(session.spacesRegistryClient);
  });
});
