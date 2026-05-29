import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the runtime edges so importing pubspace.ts under Node doesn't pull in the expo
// client/config. ConflictError/StarfishHttpError must be the SAME classes registry.ts
// uses for `instanceof`. `makeClient` is unused on these paths (we pass a fake client).
vi.mock('@drakkar.software/starfish-client', () => ({
  ConflictError: class ConflictError extends Error {},
  StarfishHttpError: class StarfishHttpError extends Error {
    status: number;
    constructor(status: number, body = '') {
      super(body);
      this.status = status;
    }
  },
}));
vi.mock('./client', () => ({ makeClient: vi.fn() }));
vi.mock('./paths', () => ({
  spacesPull: (u: string) => `/pull/${u}`,
  spacesPush: (u: string) => `/push/${u}`,
  roomsRegistryPull: (s: string) => `/pull/rooms/${s}`,
  roomsRegistryPush: (s: string) => `/push/rooms/${s}`,
  pubspaceRoomPush: () => '/pp',
  pubspaceRoomsPull: () => '/pp',
  pubspaceRoomsPush: () => '/pp',
  pubspaceScope: () => ({}),
  bytesToHex: (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''),
}));
// In-memory kv so pubspace-caps persists without localStorage/AsyncStorage.
const store = new Map<string, string>();
vi.mock('./kv', () => ({
  kvGet: async (k: string) => (store.has(k) ? store.get(k)! : null),
  kvSet: async (k: string, v: string) => void store.set(k, v),
  kvRemove: async (k: string) => void store.delete(k),
}));

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { sealToSelf, unsealFromSelf } from './account-seal';
import type { Session } from './identity';
import { recoverPubspaceAccess } from './pubspace';
import {
  clearPubspaceCaps,
  getPubspaceAccess,
  hydratePubspaceCaps,
  savePubspaceAccess,
} from './pubspace-caps';

function fakeClient() {
  return {
    pull: vi.fn(async () => ({ data: { v: 1, spaces: [], caps: {} }, hash: 'h' })),
    push: vi.fn(async () => undefined),
  };
}

async function makeSession() {
  const keys = generateDeviceKeys();
  const client = fakeClient();
  const session = { userId: 'u', keys, accountClient: client } as unknown as Session;
  clearPubspaceCaps();
  store.clear();
  await hydratePubspaceCaps('u'); // sets the active user so persist() targets its key
  return { session, client };
}

const ACCESS = { ownerId: 'o', cap: { c: 1 }, key: 'cafef00d', write: true };

describe('recoverPubspaceAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('RECOVER: unseals a server entry into the local cache (fresh device gains access)', async () => {
    const { session, client } = await makeSession();
    const sealed = await sealToSelf(session, JSON.stringify(ACCESS));

    await recoverPubspaceAccess(session, { 'psp-remote': sealed });

    expect(getPubspaceAccess('psp-remote')).toEqual(ACCESS);
    // The entry was already on the server → nothing to backfill.
    expect(client.push).not.toHaveBeenCalled();
  });

  it('BACKFILL: seals a device-local-only entry and uploads it (heals other devices)', async () => {
    const { session, client } = await makeSession();
    savePubspaceAccess('psp-local', ACCESS); // joined before sync existed — local only

    await recoverPubspaceAccess(session, {}); // server has nothing yet

    expect(client.push).toHaveBeenCalledTimes(1);
    const pushed = (client.push.mock.calls[0] as unknown[])[1] as { pubAccess: Record<string, unknown> };
    expect(Object.keys(pushed.pubAccess)).toEqual(['psp-local']);
    // The uploaded blob is sealed and round-trips back to the original credential.
    expect(JSON.parse(await unsealFromSelf(session, pushed.pubAccess['psp-local'] as never))).toEqual(ACCESS);
  });

  it('does not re-upload an entry already present on the server', async () => {
    const { session, client } = await makeSession();
    const sealed = await sealToSelf(session, JSON.stringify(ACCESS));
    savePubspaceAccess('psp-both', ACCESS); // present locally AND on the server

    await recoverPubspaceAccess(session, { 'psp-both': sealed });

    expect(client.push).not.toHaveBeenCalled();
  });
});
