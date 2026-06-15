import { describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// Mock the SDK's openEncryptor so we can drive it from client.ts's wrapper deterministically.
const sdkOpenEncryptor = vi.fn();
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@drakkar.software/octospaces-sdk')>();
  return { ...orig, openEncryptor: (...args: unknown[]) => sdkOpenEncryptor(...args), buildEncryptor: async (...args: unknown[]) => sdkOpenEncryptor(...args).catch(() => null) };
});

import { openEncryptor } from './client';
import { SpaceAccessError } from './space-access-error';

describe('openEncryptor error classification', () => {
  const keys = generateDeviceKeys();

  it('throws SpaceAccessError when this device is NOT a keyring recipient (the DM-on-paired-device case)', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new SpaceAccessError('not a recipient'));
    const client = { pull: vi.fn() } as never;
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('throws SpaceAccessError when the space has no keyring yet', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new SpaceAccessError('no keyring'));
    const client = { pull: vi.fn() } as never;
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('throws a plain (NON-access) Error when the server is unreachable — stays an offline signal', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new Error('network down'));
    const client = { pull: vi.fn() } as never;
    const err = await openEncryptor(client, keys, 'dm-abc', ['peerEdPub']).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SpaceAccessError);
  });

  it('returns the encryptor when this device IS a recipient', async () => {
    const enc = { decrypt: vi.fn() };
    sdkOpenEncryptor.mockResolvedValueOnce(enc);
    const client = { pull: vi.fn() } as never;
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).resolves.toBe(enc);
  });
});
