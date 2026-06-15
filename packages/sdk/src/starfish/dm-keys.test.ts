/**
 * Tests for dm-keys: readPeerKeys, which reads a peer's public identity keys
 * from their profile (needed for sealing a DM-space keyring to them).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  readProfile: vi.fn(),
}));

import { readProfile } from './client';
import { readPeerKeys } from './dm-keys';

beforeEach(() => vi.clearAllMocks());

describe('readPeerKeys', () => {
  it('returns {edPub, kemPub} when the profile has both keys', async () => {
    vi.mocked(readProfile).mockResolvedValue({ edPub: 'edpub-x', kemPub: 'kempub-x', pseudo: null, avatar: null } as never);
    const result = await readPeerKeys('u-abc');
    expect(result).toEqual({ edPub: 'edpub-x', kemPub: 'kempub-x' });
    expect(readProfile).toHaveBeenCalledWith('u-abc');
  });

  it('returns null when edPub is missing', async () => {
    vi.mocked(readProfile).mockResolvedValue({ edPub: null, kemPub: 'kempub-x', pseudo: null, avatar: null } as never);
    expect(await readPeerKeys('u-abc')).toBeNull();
  });

  it('returns null when kemPub is missing', async () => {
    vi.mocked(readProfile).mockResolvedValue({ edPub: 'edpub-x', kemPub: null, pseudo: null, avatar: null } as never);
    expect(await readPeerKeys('u-abc')).toBeNull();
  });

  it('returns null when both keys are missing (profile not yet published)', async () => {
    vi.mocked(readProfile).mockResolvedValue({ edPub: null, kemPub: null, pseudo: null, avatar: null } as never);
    expect(await readPeerKeys('u-abc')).toBeNull();
  });
});
