import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    buildNodeAccess: vi.fn(),
  };
});

import { buildNodeAccess } from '@drakkar.software/starfish-spaces';
import { buildNodeAccessShared, clearBuildNodeAccessCache } from './node-access-cache';
import { makeMockSession } from '../test-utils/mock-session';

const session = makeMockSession({ userId: 'u1' });
const handle = { client: {}, encryptor: {} };

beforeEach(() => {
  vi.mocked(buildNodeAccess).mockReset();
  clearBuildNodeAccessCache();
});

describe('buildNodeAccessShared — plaintext pass-through', () => {
  it('passes enc:false calls directly to buildNodeAccess without caching', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: false });
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: false });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
  });

  it('passes omitted enc calls directly to buildNodeAccess without caching', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    await buildNodeAccessShared(session, 'sp-1', 'r-1', {});
    await buildNodeAccessShared(session, 'sp-1', 'r-1', {});
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
  });
});

describe('buildNodeAccessShared — in-flight dedup', () => {
  it('concurrent calls with the same enc key share one in-flight Promise', async () => {
    let resolve!: (v: typeof handle) => void;
    vi.mocked(buildNodeAccess).mockImplementation(() => new Promise<typeof handle>((r) => { resolve = r; }) as never);

    const [a, b, c] = await Promise.all([
      buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true }),
      buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true }),
      buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true }),
      (resolve(handle), Promise.resolve()),
    ]).then((r) => r as unknown as [typeof handle, typeof handle, typeof handle]);

    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(1);
    expect(a).toBe(handle);
    expect(b).toBe(handle);
    expect(c).toBe(handle);
  });

  it('concurrent calls with the same invite key share one in-flight Promise', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    const [a, b] = await Promise.all([
      buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true, access: 'invite' }),
      buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true, access: 'invite' }),
    ]);
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

describe('buildNodeAccessShared — result cache', () => {
  it('returns cached result immediately without a second buildNodeAccess call', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    const first = await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    const second = await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('does not cache null results — next call retries', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(null);
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    const result = await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
    expect(result).toBe(handle);
  });

  it('uses separate cache keys for invite vs non-invite enc', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true, access: 'invite' });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
  });

  it('non-invite enc nodes in the SAME space share one cache entry (space-level key)', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    const a = await buildNodeAccessShared(session, 'sp-1', 'r-A', { enc: true });
    const b = await buildNodeAccessShared(session, 'sp-1', 'r-B', { enc: true });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(1); // one _keyring pull covers the whole space
    expect(a).toBe(b);
  });

  it('non-invite enc nodes in DIFFERENT spaces have separate cache entries', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    await buildNodeAccessShared(session, 'sp-2', 'r-1', { enc: true });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
  });

  it('uses separate cache keys for different userIds', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    const s2 = makeMockSession({ userId: 'u2' });
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    await buildNodeAccessShared(s2, 'sp-1', 'r-1', { enc: true });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
  });
});

describe('clearBuildNodeAccessCache', () => {
  it('clears the result cache so the next call re-fetches', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(handle as never);
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    clearBuildNodeAccessCache();
    await buildNodeAccessShared(session, 'sp-1', 'r-1', { enc: true });
    expect(vi.mocked(buildNodeAccess)).toHaveBeenCalledTimes(2);
  });
});
