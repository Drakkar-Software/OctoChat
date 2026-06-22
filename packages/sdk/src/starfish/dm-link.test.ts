import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// Mock the heavy orchestration deps (space creation, invite, registry writes, runtime config) so
// dm-link's own logic — verification delegation, ordering, request-link wrapping — is what's under
// test. Crypto (hashing, sealing, author proofs, kemSig) stays REAL; delivery is intercepted at
// `fetch`. The identity-token encode/decode/binding live in starfish-spaces (tested there) — keep
// them real (importOriginal); only the live-profile cross-check (`verifyIdentityLinkKeys`) is
// stubbed so resolveLinkOwner's success/failure is deterministic without a network profile read.
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyIdentityLinkKeys: vi.fn(async () => undefined),
}));
vi.mock('./dm', () => ({
  createDmSpaceCore: vi.fn(async () => ({ spaceId: 'dm-new', roomId: 'dm-dm-new-dm' })),
  dmSpaceRecord: (id: string, pseudo: string) => ({ id, name: pseudo, short: 'XX', members: 2 }),
}));
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

import { decodeIdentityLink, myIdentityLink, verifyIdentityLinkKeys, type IdentityLink } from '@drakkar.software/starfish-spaces';
import { createDmSpaceCore } from './dm';
import { inviteToSpace } from './members';
import {
  createDmViaLink,
  resolveLinkOwner,
  encodeRequestLink,
  decodeRequestLink,
} from './dm-link';
import type { Session } from './identity';
import { dmInboxShard, userIdFromEdPub } from './paths';
import { addJoinedSpace, readSpaces, setDmMapping } from './registry';

async function sess(name = 'tester'): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdFromEdPub(keys.edPub);
  return {
    userId,
    name,
    keys,
    ownerEdPub: keys.edPub,
    accountClient: {},
    spacesRegistryClient: {},
    // userIdFromEdPub is required by resolveLinkOwner (new in Session 0.25)
    userIdFromEdPub: async (pub: string) => userIdFromEdPub(pub),
  } as unknown as Session;
}

/** A WELL-FORMED v:2 identity token for a real identity (ownerId derived from edPub, valid kemSig).
 *  Minted via the real `myIdentityLink` so the signature actually verifies. */
async function mintToken(
  pseudo = 'Alice',
): Promise<{ token: IdentityLink; link: string; keys: ReturnType<typeof generateDeviceKeys> }> {
  const keys = generateDeviceKeys();
  const owner = { userId: await userIdFromEdPub(keys.edPub), name: pseudo, keys, ownerEdPub: keys.edPub } as unknown as Session;
  const link = (await myIdentityLink(owner, 'https://oc.example', 'dm'))!;
  return { token: decodeIdentityLink(link.slice(link.indexOf('#') + 1)), link, keys };
}

const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSpaces).mockResolvedValue({ dms: {} } as never);
  vi.mocked(verifyIdentityLinkKeys).mockResolvedValue(undefined);
  vi.stubGlobal('fetch', okFetch());
});

describe('resolveLinkOwner', () => {
  it('returns the trusted peer for a well-formed token (including kemSig)', async () => {
    const session = await sess();
    const { token } = await mintToken();
    expect(await resolveLinkOwner(token, session)).toEqual({
      userId: token.ownerId,
      edPub: token.edPub,
      kemPub: token.kemPub,
      kemSig: token.kemSig,
    });
    expect(verifyIdentityLinkKeys).toHaveBeenCalledWith(token, session); // live cross-check is run
  });

  it('rejects a token whose ownerId is not the hash of its edPub (tampered routing)', async () => {
    const session = await sess();
    const { token } = await mintToken();
    const tampered = { ...token, ownerId: await userIdFromEdPub('f'.repeat(64)) };
    await expect(resolveLinkOwner(tampered, session)).rejects.toThrow(/malformed|verify/i);
  });

  it('propagates a live-profile key mismatch (kem swap caught by the cross-check)', async () => {
    const session = await sess();
    const { token } = await mintToken();
    vi.mocked(verifyIdentityLinkKeys).mockRejectedValueOnce(new Error("doesn't match the owner's published identity keys"));
    await expect(resolveLinkOwner(token, session)).rejects.toThrow(/published identity keys/);
  });
});

describe('createDmViaLink', () => {
  it('rejects your own link before any network work', async () => {
    const session = await sess();
    const own = await mintToken('Me');
    const token = { ...own.token, ownerId: session.userId };
    await expect(createDmViaLink(session, token, 'Me')).rejects.toThrow(/your own/);
    expect(vi.mocked(createDmSpaceCore)).not.toHaveBeenCalled();
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

    // Regression guard: inviteToSpace must receive a requestJson that includes kemSig so that
    // parseJoinRequest (starfish-spaces) does not reject it as "kemSig is missing or invalid".
    const requestJson = vi.mocked(inviteToSpace).mock.calls[0]?.[2] as string;
    const req = JSON.parse(requestJson) as { edPub?: string; kemPub?: string; userId?: string; kemSig?: string };
    expect(typeof req.kemSig).toBe('string');
    expect(req.kemSig).toBe(token.kemSig);

    const [url, init] = vi.mocked(fetch).mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`https://sync.test/push/inbox/${token.ownerId}/${dmInboxShard()}`);
    expect(Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain('authorization');
    const body = JSON.parse(init.body as string) as { data: { sealed?: { ct?: string } }; authorPubkey?: string; authorSignature?: string };
    expect(body.data.sealed?.ct).toBeTruthy(); // sealed blob, never plaintext
    expect(body.authorPubkey).toBe(session.keys.edPub); // signed with the SENDER's key
    expect(body.authorSignature).toBeTruthy();
    expect(vi.mocked(addJoinedSpace)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setDmMapping)).toHaveBeenCalledWith(session.spacesRegistryClient, session, token.ownerId, 'dm-new');
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

describe('encodeRequestLink / decodeRequestLink', () => {
  it('packs the target space as ?s before the fragment (merging an existing query)', () => {
    expect(encodeRequestLink('https://x/request#FRAG', 'sp-1')).toBe('https://x/request?s=sp-1#FRAG');
    expect(encodeRequestLink('https://x/request?a=1#FRAG', 'sp-1')).toBe('https://x/request?a=1&s=sp-1#FRAG');
  });

  it('round-trips a real identity token + target space', async () => {
    const { token, link } = await mintToken('Owner');
    const decoded = decodeRequestLink(encodeRequestLink(link, 'sp-9'));
    expect(decoded.spaceId).toBe('sp-9');
    expect(decoded.identity.ownerId).toBe(token.ownerId);
    expect(decoded.identity.kemPub).toBe(token.kemPub);
  });

  it('a bare identity link decodes with a null space', async () => {
    const { token, link } = await mintToken();
    const decoded = decodeRequestLink(link);
    expect(decoded.spaceId).toBeNull();
    expect(decoded.identity.ownerId).toBe(token.ownerId);
  });
});
