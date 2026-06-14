import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateArchivedDmsDoc = vi.fn(async () => {});
vi.mock('../starfish/registry', () => ({
  updateArchivedDmsDoc: (...args: unknown[]) =>
    (updateArchivedDmsDoc as (...a: unknown[]) => Promise<void>)(...args),
}));

import {
  getArchivedDms,
  hydrateArchivedDms,
  isDmArchived,
  resetArchivedDms,
  setDmArchived,
} from './archived-dms';

const SESSION = { userId: 'u', accountClient: {}, spacesRegistryClient: {} } as never;

beforeEach(() => {
  updateArchivedDmsDoc.mockReset();
  updateArchivedDmsDoc.mockResolvedValue(undefined);
  resetArchivedDms();
});

describe('isDmArchived', () => {
  it('returns false for an unknown space id', () => {
    expect(isDmArchived('dm-xyz')).toBe(false);
  });

  it('returns true after archiving', async () => {
    await setDmArchived(SESSION, 'dm-abc', true);
    expect(isDmArchived('dm-abc')).toBe(true);
  });

  it('returns false after unarchiving', async () => {
    await setDmArchived(SESSION, 'dm-abc', true);
    await setDmArchived(SESSION, 'dm-abc', false);
    expect(isDmArchived('dm-abc')).toBe(false);
  });
});

describe('setDmArchived idempotency', () => {
  it('does not write when already in the wanted state', async () => {
    // Not archived — trying to unarchive again is a no-op.
    await setDmArchived(SESSION, 'dm-abc', false);
    expect(updateArchivedDmsDoc).not.toHaveBeenCalled();
  });

  it('writes only once when archiving an unarchived space', async () => {
    await setDmArchived(SESSION, 'dm-abc', true);
    expect(updateArchivedDmsDoc).toHaveBeenCalledTimes(1);
  });
});

describe('hydrateArchivedDms in-flight guard', () => {
  it('does not revert an optimistic archive while its server write is still pending', async () => {
    let release = () => {};
    updateArchivedDmsDoc.mockImplementation(
      () => new Promise<void>((r) => (release = r)),
    );

    const p = setDmArchived(SESSION, 'dm-s1', true); // optimistic: archived; push in flight
    expect(isDmArchived('dm-s1')).toBe(true);

    // A navigation re-pull returns stale server doc (not yet archived) — must be ignored.
    hydrateArchivedDms({});
    expect(isDmArchived('dm-s1')).toBe(true);

    release();
    await p;

    // Guard released — normal re-hydrate now applies server state.
    hydrateArchivedDms({});
    expect(isDmArchived('dm-s1')).toBe(false);
  });

  it('applies a remote archive on a normal re-hydrate (no write in flight)', () => {
    hydrateArchivedDms({ 'dm-s2': true });
    expect(isDmArchived('dm-s2')).toBe(true);
  });

  it('skips emit when the server set equals the current snapshot', () => {
    hydrateArchivedDms({ 'dm-s3': true });
    const before = getArchivedDms();
    hydrateArchivedDms({ 'dm-s3': true });
    // Snapshot reference must be the same object (no unnecessary re-render).
    expect(getArchivedDms()).toBe(before);
  });
});

describe('resetArchivedDms', () => {
  it('clears the snapshot on sign-out', async () => {
    await setDmArchived(SESSION, 'dm-abc', true);
    expect(isDmArchived('dm-abc')).toBe(true);
    resetArchivedDms();
    expect(isDmArchived('dm-abc')).toBe(false);
  });
});
