import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// Mock the heavy orchestration deps (space creation, profile lookup, invite,
// registry writes, the SDK runtime config) so dm-link's own logic — token
// handling, identity binding, ordering — is what's under test. Crypto (hashing,
// sealing, author proofs) stays REAL; delivery is intercepted at `fetch`.
vi.mock('./dm', () => ({
  createDmSpaceCore: vi.fn(async () => ({ spaceId: 'dm-new', roomId: 'dm-dm-new-dm' })),
  dmSpaceRecord: (id: string, pseudo: string) => ({ id, name: pseudo, short: 'XX', members: 2 }),
}));
vi.mock('./dm-keys', () => ({ readPeerKeys: vi.fn(async () => null) }));
vi.mock('./members', () => ({ inviteToSpace: vi.fn(async () => JSON.stringify({ spaceId: 'dm-new', cap: {} })) }));
vi.mock('./registry', () => ({
  readSpaces: vi.fn(async () => ({ dms: {} })),
  addJoinedSpace: vi.fn(async () => undefined),
  setDmMapping: vi.fn(async () => undefined),
}));
vi.mock('../config/config', () => ({
  getSyncBase: () => 'https://sync.test',
  getSyncNamespace: () => undefined,
}));

import { createDmSpaceCore } from './dm';
import { readPeerKeys } from './dm-keys';
import { createDmViaLink, decodeDmLink, encodeDmLink, myDmLink, verifyDmLinkBinding, type DmLinkToken } from './dm-link';
import type { Session } from './identity';
import { dmInboxShard, userIdFromEdPub } from './paths';
import { addJoinedSpace, readSpaces, setDmMapping } from './registry';

async function sess(name = 'tester'): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdFromEdPub(keys.edPub);
  return { userId, name, keys, ownerEdPub: keys.edPub, accountClient: {}, spacesRegistryClient: {} } as unknown as Session;
}

/** A WELL-FORMED token for a real identity (ownerId derived from edPub). */
async function mintToken(pseudo = 'Alice'): Promise<{ token: DmLinkToken; keys: ReturnType<typeof generateDeviceKeys> }> {
  const keys = generateDeviceKeys();
  return {
    token: { v: 1, ownerId: await userIdFromEdPub(keys.edPub), pseudo, edPub: keys.edPub, kemPub: keys.kemPub },
    keys,
  };
}

const okFetch = () =>
  vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSpaces).mockResolvedValue({ dms: {} } as never);
  vi.mocked(readPeerKeys).mockResolvedValue(null);
  vi.stubGlobal('fetch', okFetch());
});

describe('encodeDmLink / decodeDmLink / myDmLink', () => {
  it('round-trips the identity through a /dm# fragment', async () => {
    const { token } = await mintToken();
    const url = encodeDmLink('https://oc.example//', token);
    expect(url.startsWith('https://oc.example/dm#')).toBe(true);
    expect(decodeDmLink(url.slice(url.indexOf('#')))).toEqual(token);
  });

  it('rejects malformed fragments, wrong versions and bad ids/keys', async () => {
    const { token } = await mintToken();
    const enc = (t: object) => '#' + Buffer.from(JSON.stringify(t), 'utf-8').toString('base64url');
    expect(() => decodeDmLink('#not-base64-json')).toThrow(/malformed/);
    expect(() => decodeDmLink(enc({ ...token, v: 2 }))).toThrow(/malformed/);
    expect(() => decodeDmLink(enc({ ...token, ownerId: 'NOT-HEX' }))).toThrow(/malformed/);
    expect(() => decodeDmLink(enc({ ...token, edPub: 'abc' }))).toThrow(/malformed/);
    expect(() => decodeDmLink(enc({ ...token, kemPub: '' }))).toThrow(/malformed/);
  });

  it('myDmLink derives the same permanent link from the root session, no network', async () => {
    const session = await sess('Me');
    const link = await myDmLink(session, 'https://oc.example');
    const decoded = decodeDmLink(link!.slice(link!.indexOf('#')));
    expect(decoded).toEqual({ v: 1, ownerId: session.userId, pseudo: 'Me', edPub: session.keys.edPub, kemPub: session.keys.kemPub });
    expect(vi.mocked(readPeerKeys)).not.toHaveBeenCalled(); // root keys come from the session
    // Stable: deriving again yields the identical URL (nothing random inside).
    expect(await myDmLink(session, 'https://oc.example')).toBe(link);
  });

  it('myDmLink on a paired device resolves the PUBLISHED root keys via the profile', async () => {
    const session = await sess('Me');
    const rootKeys = { edPub: 'a'.repeat(64), kemPub: 'b'.repeat(64) };
    (session as { ownerEdPub: string }).ownerEdPub = rootKeys.edPub; // device key ≠ root key
    vi.mocked(readPeerKeys).mockResolvedValue(rootKeys as never);
    const link = await myDmLink(session, 'https://oc.example');
    const decoded = decodeDmLink(link!.slice(link!.indexOf('#')));
    expect(decoded.edPub).toBe(rootKeys.edPub);
    expect(decoded.kemPub).toBe(rootKeys.kemPub);
    // Unpublished keys (brand-new identity) ⇒ no link yet.
    vi.mocked(readPeerKeys).mockResolvedValue(null);
    expect(await myDmLink(session, 'https://oc.example')).toBeNull();
  });
});

describe('createDmViaLink', () => {
  it('rejects your own link before any network work', async () => {
    const session = await sess();
    const token: DmLinkToken = { v: 1, ownerId: session.userId, pseudo: 'Me', edPub: session.keys.edPub, kemPub: session.keys.kemPub };
    await expect(createDmViaLink(session, token, 'Me')).rejects.toThrow(/your own/);
    expect(vi.mocked(createDmSpaceCore)).not.toHaveBeenCalled();
  });

  it('rejects a token whose ownerId is not the hash of its edPub (tampered routing)', async () => {
    const session = await sess();
    const { token } = await mintToken();
    const tampered = { ...token, ownerId: await userIdFromEdPub('f'.repeat(64)) }; // points at someone else
    expect(await verifyDmLinkBinding(token)).toBe(true);
    expect(await verifyDmLinkBinding(tampered)).toBe(false);
    await expect(createDmViaLink(session, tampered, 'Alice')).rejects.toThrow(/malformed/);
    expect(vi.mocked(createDmSpaceCore)).not.toHaveBeenCalled();
  });

  it('rejects a token whose keys disagree with the owner’s reachable profile (kem swap)', async () => {
    const session = await sess();
    const { token, keys } = await mintToken();
    // Profile reachable and authoritative: same edPub, DIFFERENT kem key.
    vi.mocked(readPeerKeys).mockResolvedValue({ edPub: keys.edPub, kemPub: 'c'.repeat(64) } as never);
    await expect(createDmViaLink(session, token, 'Alice')).rejects.toThrow(/published identity keys/);
    expect(vi.mocked(createDmSpaceCore)).not.toHaveBeenCalled();
  });

  it('proceeds on the embedded keys when the profile is unreachable (server-independent first contact)', async () => {
    const session = await sess();
    const { token } = await mintToken();
    vi.mocked(readPeerKeys).mockRejectedValue(new Error('offline'));
    const ref = await createDmViaLink(session, token, 'Alice');
    expect(ref.spaceId).toBe('dm-new');
  });

  it('short-circuits to the existing DM for an already-mapped peer', async () => {
    const session = await sess();
    const { token } = await mintToken();
    vi.mocked(readSpaces).mockResolvedValue({ dms: { [token.ownerId]: 'dm-exist' } } as never);
    const ref = await createDmViaLink(session, token, 'Alice');
    expect(ref.spaceId).toBe('dm-exist');
    expect(vi.mocked(createDmSpaceCore)).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('delivers anonymously (no Authorization) with a sealed element + author proof, then registers', async () => {
    const session = await sess('Bob');
    const { token } = await mintToken();
    const ref = await createDmViaLink(session, token, 'Alice');
    expect(ref).toEqual({ spaceId: 'dm-new', roomId: 'dm-dm-new-dm' });

    const [url, init] = vi.mocked(fetch).mock.calls[0]! as unknown as [string, RequestInit];
    // Delivered to the owner's CURRENT month shard.
    expect(url).toBe(`https://sync.test/push/inbox/${token.ownerId}/${dmInboxShard()}`);
    // ANONYMOUS: the request carries no Authorization / redeem headers.
    expect(Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain('authorization');
    const body = JSON.parse(init.body as string) as { data: { sealed?: { ct?: string } }; authorPubkey?: string; authorSignature?: string };
    // The element is a sealed blob (the owner trial-unseals it) — never plaintext.
    expect(body.data.sealed?.ct).toBeTruthy();
    // The append author proof is signed with the SENDER's own identity key.
    expect(body.authorPubkey).toBe(session.keys.edPub);
    expect(body.authorSignature).toBeTruthy();
    // Registered only after delivery succeeded.
    expect(vi.mocked(addJoinedSpace)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setDmMapping)).toHaveBeenCalledWith(session.spacesRegistryClient, session.userId, token.ownerId, 'dm-new');
  });

  it('registers nothing when delivery fails (no ghost DM)', async () => {
    const session = await sess();
    const { token } = await mintToken();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, text: async () => 'full' }) as unknown as Response));
    await expect(createDmViaLink(session, token, 'Alice')).rejects.toThrow(/409/);
    expect(vi.mocked(addJoinedSpace)).not.toHaveBeenCalled();
    expect(vi.mocked(setDmMapping)).not.toHaveBeenCalled();
  });
});
