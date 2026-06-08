import { describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// Mock the keyring crypto so we can drive openEncryptor's two failure modes deterministically
// (no real crypto / no network): a present keyring that the device CAN'T decrypt, vs. one it can.
const createKeyringEncryptor = vi.fn();
vi.mock('@drakkar.software/starfish-keyring', () => ({
  createKeyring: vi.fn(),
  createKeyringEncryptor: (...args: unknown[]) => createKeyringEncryptor(...args),
}));

import { openEncryptor } from './client';
import { SpaceAccessError } from './space-access-error';

/** A keyring-shaped doc (has `epochs`) so openEncryptor proceeds to the recipient check. */
const keyringDoc = { epochs: [{ id: 0 }] };

describe('openEncryptor error classification', () => {
  const keys = generateDeviceKeys();

  it('throws SpaceAccessError when this device is NOT a keyring recipient (the DM-on-paired-device case)', async () => {
    const client = { pull: vi.fn(async () => ({ data: keyringDoc })) } as never;
    createKeyringEncryptor.mockRejectedValueOnce(new Error('not a recipient'));
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('throws SpaceAccessError when the space has no keyring yet', async () => {
    const client = { pull: vi.fn(async () => ({ data: undefined })) } as never;
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('throws a plain (NON-access) Error when the server is unreachable — stays an offline signal', async () => {
    const client = { pull: vi.fn(async () => { throw new Error('network down'); }) } as never;
    const err = await openEncryptor(client, keys, 'dm-abc', ['peerEdPub']).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SpaceAccessError);
  });

  it('returns the encryptor when this device IS a recipient', async () => {
    const client = { pull: vi.fn(async () => ({ data: keyringDoc })) } as never;
    const enc = { decrypt: vi.fn() };
    createKeyringEncryptor.mockResolvedValueOnce(enc);
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).resolves.toBe(enc);
  });
});
