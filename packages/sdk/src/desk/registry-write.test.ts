/**
 * Tests for the owner's per-node self-heal helpers:
 *  - `ensureDeskTicketStreamAccess` / `ensureDeskNodeStreamAccess` — objinvlog stream cap
 *  - `ensureDeskNodeKeyring` — per-node keyring open via ownerEnsureNodeKeyring
 * and that ticket creation establishes the stream cap. `objinvlog` admits ONLY an
 * owner-issued (delegated) cap or a narrow per-node cap — the broad owner DEVICE cap is not
 * honoured — and the owner cannot mint a member cap to ITSELF (`sub === iss` is rejected). So
 * the owner mints one to a throwaway EPHEMERAL subject it controls and stores the ephemeral
 * signing key (the createNodeInviteLink pattern). These tests pin that exact shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the octospaces-sdk surface registry-write touches (keep everything else real so
// ../starfish/paths — which re-exports from octospaces-sdk and defines userIdFromEdPub — loads).
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  nodeStreamScope: vi.fn((spaceId: string, nodeId: string, write: boolean) => ({
    __scope: 'objinvlog',
    spaceId,
    nodeId,
    write,
  })),
}));

// saveNodeStreamAccessEntry, updateObjectIndex and ownerEnsureNodeKeyring moved to starfish-spaces.
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveNodeStreamAccessEntry: vi.fn(),
  updateObjectIndex: vi.fn(async () => undefined),
  ownerEnsureNodeKeyring: vi.fn(async () => ({ __encryptor: true })),
}));

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn(async () => ({ kind: 'member', iss: 'owner-ed', sub: 'EPH', __cap: true })),
}));

vi.mock('@drakkar.software/starfish-identities', () => ({
  // A fixed ephemeral keypair so we can assert the subject + stored signing key. edPub is valid
  // hex (userIdFromEdPub hashes it for real).
  generateDeviceKeys: vi.fn(() => ({
    edPub: 'ab'.repeat(32),
    edPriv: 'eph-edpriv',
    kemPub: 'eph-kempub',
    kemPriv: 'eph-kempriv',
  })),
}));

import { ensureDeskTicketStreamAccess, ensureDeskNodeKeyring, createTicketNode } from './registry-write';
import { defaultTicketMeta } from './ticket';
import { nodeStreamScope } from '@drakkar.software/octospaces-sdk';
import { saveNodeStreamAccessEntry, ownerEnsureNodeKeyring } from '@drakkar.software/starfish-spaces';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import type { Session } from '../starfish/identity';

const session = {
  userId: 'owner-uid',
  keys: { edPub: 'owner-ed', edPriv: 'owner-edpriv', kemPub: 'owner-kem', kemPriv: 'owner-kempriv' },
} as unknown as Session;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureDeskTicketStreamAccess', () => {
  it('mints an owner-ISSUED member cap on objinvlog, to an EPHEMERAL subject (sub ≠ iss)', async () => {
    await ensureDeskTicketStreamAccess(session, 'sp-1', 'ticket-abc');

    expect(mintMemberCap).toHaveBeenCalledTimes(1);
    const [issPriv, issPub, subject, collection, scope] = vi.mocked(mintMemberCap).mock.calls[0]!;
    // Issuer = the owner.
    expect(issPriv).toBe('owner-edpriv');
    expect(issPub).toBe('owner-ed');
    // Subject = the ephemeral identity, NOT the owner — this is what dodges the member-self ban.
    expect((subject as { edPubHex: string }).edPubHex).toBe('ab'.repeat(32));
    expect((subject as { edPubHex: string }).edPubHex).not.toBe('owner-ed');
    expect((subject as { kemPubHex: string }).kemPubHex).toBe('eph-kempub');
    // The cap is scoped to the node's objinvlog (write), via nodeStreamScope(space, node, true).
    expect(collection).toBe('objinvlog');
    expect(nodeStreamScope).toHaveBeenCalledWith('sp-1', 'ticket-abc', true);
    expect(scope).toMatchObject({ __scope: 'objinvlog', spaceId: 'sp-1', nodeId: 'ticket-abc', write: true });
  });

  it('stores a writable LINK entry holding the minted cap + the ephemeral signing key', async () => {
    await ensureDeskTicketStreamAccess(session, 'sp-1', 'ticket-abc');
    expect(saveNodeStreamAccessEntry).toHaveBeenCalledWith('sp-1', 'ticket-abc', {
      kind: 'link',
      cap: { kind: 'member', iss: 'owner-ed', sub: 'EPH', __cap: true },
      key: 'eph-edpriv', // the ephemeral private key, NOT the owner's
      write: true,
    });
  });
});

describe('createTicketNode', () => {
  it('establishes owner objinvlog access (calls saveNodeStreamAccessEntry for the ticket)', async () => {
    await createTicketNode(
      session,
      'sp-1',
      'ticket-xyz',
      defaultTicketMeta({ title: 'T', requester: 'a@b.c', priority: 'high' }),
      false,
    );
    expect(saveNodeStreamAccessEntry).toHaveBeenCalledWith(
      'sp-1',
      'ticket-xyz',
      expect.objectContaining({ kind: 'link', write: true }),
    );
  });
});

describe('ensureDeskNodeKeyring', () => {
  it('delegates to ownerEnsureNodeKeyring with the session, spaceId, and nodeId', async () => {
    await ensureDeskNodeKeyring(session, 'sp-1', 'ticket-abc');
    expect(ownerEnsureNodeKeyring).toHaveBeenCalledTimes(1);
    expect(ownerEnsureNodeKeyring).toHaveBeenCalledWith(session, 'sp-1', 'ticket-abc');
  });

  it('returns the encryptor from ownerEnsureNodeKeyring', async () => {
    const result = await ensureDeskNodeKeyring(session, 'sp-1', 'ticket-abc');
    expect(result).toEqual({ __encryptor: true });
  });

  // This test pins the key contract of the bug fix: ensureDeskNodeKeyring must NOT pass any
  // reg-owner-derived argument — ownerEnsureNodeKeyring uses ownerTrustedAdders(session)
  // internally (edPub-based), not a userId string. Any extra argument here would reintroduce
  // the userId-vs-edPub trust mismatch.
  it('passes no extra trustedAdders argument (lets ownerEnsureNodeKeyring use ownerTrustedAdders)', async () => {
    await ensureDeskNodeKeyring(session, 'sp-2', 'ticket-def');
    const call = vi.mocked(ownerEnsureNodeKeyring).mock.calls[0]!;
    expect(call).toHaveLength(3); // exactly (session, spaceId, nodeId)
  });
});
