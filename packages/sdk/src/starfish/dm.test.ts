/**
 * DM access-roster tests. The `/events` SSE proxy + FCM bridge authorize a space purely
 * from `spaces/{id}/_access.{owner,members}` (the strict no-TOFU enricher — caps are
 * ignored there), while message READS are satisfied by the member cap. So a DM whose peer
 * is missing from the roster delivers history but NO live notifications/unread. These tests
 * pin the two-pronged fix:
 *   1. createDmSpaceCore SEEDS the peer into the roster at creation (no read-modify-write race).
 *   2. healDmRosters REPAIRS pre-existing DMs (owner-only, idempotent, best-effort).
 *
 * The real `addSpaceMember`/`readSpaceAccess`/`writeSpaceAccess` (octospaces-sdk, re-exported
 * via ./registry) run against an in-memory fake StarfishClient so the asserted `_access`
 * roster is the genuine end-to-end outcome — only the keyring/index side effects are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep registry / dm-ids / identity REAL; stub only the irrelevant side effects.
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ownerEnsureKeyring: vi.fn(async () => undefined),
  getSpaceClient: vi.fn(() => ({})),
}));
vi.mock('./object-index', () => ({ pushIndexSeed: vi.fn(async () => undefined), pushIndexNode: vi.fn(async () => undefined) }));

import { createDmSpaceCore, healDmRosters } from './dm';
import { isDmSpaceId } from './dm-ids';
import type { Session } from './identity';

interface AccessDoc {
  owner: string | null;
  members: string[];
  name?: string;
}

/** In-memory StarfishClient for the `spaces/{id}/_access` collection, keyed by spaceId
 *  (pull and push paths differ only by verb, so we normalize to the spaceId). */
function fakeAccessClient(seed: Record<string, AccessDoc> = {}) {
  const store = new Map<string, { data: Record<string, unknown>; hash: string }>();
  const broken = new Set<string>();
  let n = 0;
  for (const [sid, doc] of Object.entries(seed)) {
    store.set(sid, { data: { v: 1, owner: doc.owner, members: doc.members, ...(doc.name ? { name: doc.name } : {}) }, hash: `h-${sid}-0` });
  }
  const sidOf = (path: string): string => path.match(/spaces\/([^/]+)\/_access/)?.[1] ?? path;
  const client = {
    store,
    broken,
    pull: async (path: string) => {
      const sid = sidOf(path);
      if (broken.has(sid)) throw new Error('unreadable space'); // non-404 → readSpaceAccess re-throws
      return store.get(sid) ?? null;
    },
    push: async (path: string, data: Record<string, unknown>) => {
      store.set(sidOf(path), { data, hash: `h-${sidOf(path)}-${++n}` });
    },
  };
  return client;
}

function sessionWith(client: ReturnType<typeof fakeAccessClient>, userId = 'me'): Session {
  return {
    userId,
    name: 'Me',
    keys: { edPub: 'ed-pub', edPriv: 'ed-priv', kemPub: 'kem-pub', kemPriv: 'kem-priv' },
    contentClient: client,
    accountClient: client,
    spacesRegistryClient: client,
  } as unknown as Session;
}

beforeEach(() => vi.clearAllMocks());

// ── createDmSpaceCore: seed the roster at creation ─────────────────────────────────

describe('createDmSpaceCore — roster seeding', () => {
  it('seeds the peer into _access.members in one owner write', async () => {
    const client = fakeAccessClient();
    const ref = await createDmSpaceCore(sessionWith(client), 'Alice', 'peer-1');
    expect(isDmSpaceId(ref.spaceId)).toBe(true);
    expect(client.store.get(ref.spaceId)!.data).toMatchObject({ owner: 'me', members: ['peer-1'] });
  });

  it('leaves members empty when no peer id is supplied (back-compat)', async () => {
    const client = fakeAccessClient();
    const ref = await createDmSpaceCore(sessionWith(client), 'Alice');
    expect(client.store.get(ref.spaceId)!.data).toMatchObject({ owner: 'me', members: [] });
  });
});

// ── healDmRosters: repair existing DMs ─────────────────────────────────────────────

describe('healDmRosters — repair existing DM rosters', () => {
  it('adds the missing peer to a DM we own', async () => {
    const client = fakeAccessClient({ 'dm-1': { owner: 'me', members: [] } });
    await healDmRosters(sessionWith(client), { 'peer-1': 'dm-1' });
    expect(client.store.get('dm-1')!.data.members).toEqual(['peer-1']);
  });

  it('is idempotent — no write when the peer is already a member', async () => {
    const client = fakeAccessClient({ 'dm-1': { owner: 'me', members: ['peer-1'] } });
    const before = client.store.get('dm-1')!.hash;
    await healDmRosters(sessionWith(client), { 'peer-1': 'dm-1' });
    expect(client.store.get('dm-1')!.hash).toBe(before); // unchanged → no push
  });

  it('does NOT rewrite a DM the peer owns (we are not the owner)', async () => {
    const client = fakeAccessClient({ 'dm-1': { owner: 'peer-1', members: ['me'] } });
    const before = client.store.get('dm-1')!.hash;
    await healDmRosters(sessionWith(client), { 'peer-1': 'dm-1' });
    expect(client.store.get('dm-1')!.data).toMatchObject({ owner: 'peer-1', members: ['me'] });
    expect(client.store.get('dm-1')!.hash).toBe(before); // no-op (peer === owner)
  });

  it('is best-effort: one unreadable DM does not abort the rest', async () => {
    const client = fakeAccessClient({ 'dm-1': { owner: 'me', members: [] }, 'dm-2': { owner: 'me', members: [] } });
    client.broken.add('dm-1');
    await expect(healDmRosters(sessionWith(client), { pa: 'dm-1', pb: 'dm-2' })).resolves.toBeUndefined();
    expect(client.store.get('dm-2')!.data.members).toEqual(['pb']); // dm-2 still healed
  });

  it('skips non-DM space ids', async () => {
    const client = fakeAccessClient({ 'sp-x': { owner: 'me', members: [] } });
    const before = client.store.get('sp-x')!.hash;
    await healDmRosters(sessionWith(client), { 'peer-1': 'sp-x' });
    expect(client.store.get('sp-x')!.hash).toBe(before); // not a dm- id → untouched
  });
});
