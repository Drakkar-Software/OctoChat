import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// Mock the SDK's openEncryptor so we can drive it from client.ts's wrapper deterministically.
const sdkOpenEncryptor = vi.fn();
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@drakkar.software/starfish-spaces')>();
  return { ...orig, openEncryptor: (...args: unknown[]) => sdkOpenEncryptor(...args), buildEncryptor: async (...args: unknown[]) => sdkOpenEncryptor(...args).catch(() => null) };
});

// Mock ./paths so keyringPull is deterministic in tests (the real one requires config boot).
vi.mock('./paths', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, keyringPull: (spaceId: string) => `/pull/spaces/${spaceId}/_keyring` };
});

import { buildEncryptor, openEncryptor } from './client';
import { SpaceAccessError } from './space-access-error';

describe('openEncryptor / buildEncryptor', () => {
  const keys = generateDeviceKeys();
  const client = { pull: vi.fn() } as never;

  beforeEach(() => { vi.clearAllMocks(); });

  // ── Path forwarding ─────────────────────────────────────────────────────────
  // The wrapper's only job is translating spaceId → keyringPull(spaceId). If that
  // translation is ever broken (e.g. keyringPull import removed), these tests catch it.

  it('forwards spaceId as keyringPull(spaceId) path to the SDK openEncryptor', async () => {
    sdkOpenEncryptor.mockResolvedValueOnce({ decrypt: vi.fn() });
    await openEncryptor(client, keys, 'sp-123', ['ownerPub']);
    expect(sdkOpenEncryptor).toHaveBeenCalledWith(client, keys, '/pull/spaces/sp-123/_keyring', ['ownerPub']);
  });

  it('forwards spaceId as keyringPull(spaceId) path to the SDK via buildEncryptor', async () => {
    sdkOpenEncryptor.mockResolvedValueOnce({ decrypt: vi.fn() });
    await buildEncryptor(client, keys, 'sp-456', ['ownerPub']);
    expect(sdkOpenEncryptor).toHaveBeenCalledWith(client, keys, '/pull/spaces/sp-456/_keyring', ['ownerPub']);
  });

  // ── Error classification ────────────────────────────────────────────────────

  it('throws SpaceAccessError when this device is NOT a keyring recipient (the DM-on-paired-device case)', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new SpaceAccessError('not a recipient'));
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('throws SpaceAccessError when the space has no keyring yet', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new SpaceAccessError('no keyring'));
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('throws a plain (NON-access) Error when the server is unreachable — stays an offline signal', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new Error('network down'));
    const err = await openEncryptor(client, keys, 'dm-abc', ['peerEdPub']).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SpaceAccessError);
  });

  it('returns the encryptor when this device IS a recipient', async () => {
    const enc = { decrypt: vi.fn() };
    sdkOpenEncryptor.mockResolvedValueOnce(enc);
    await expect(openEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).resolves.toBe(enc);
  });

  // ── buildEncryptor soft-variant ─────────────────────────────────────────────

  it('buildEncryptor returns null instead of throwing on SpaceAccessError', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new SpaceAccessError('no keyring'));
    await expect(buildEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).resolves.toBeNull();
  });

  it('buildEncryptor returns null instead of throwing on plain network error', async () => {
    sdkOpenEncryptor.mockRejectedValueOnce(new Error('network down'));
    await expect(buildEncryptor(client, keys, 'dm-abc', ['peerEdPub'])).resolves.toBeNull();
  });
});
