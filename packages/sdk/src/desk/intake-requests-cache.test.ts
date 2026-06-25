/**
 * SWR cache for inbox pending requests.
 *
 * These tests mock the network scan (`listPendingTicketRequestsForSpaces`) and assert
 * the cache behavior in isolation:
 *   - two reads within the TTL issue ONE scan (second serves cached)
 *   - a read past the TTL serves stale synchronously AND triggers a revalidation
 *   - a changed space-set bypasses the TTL (fresh scan)
 *   - `removePendingFromCache` drops the reqId from the cached snapshot
 *   - `clearInboxRequestsCache` makes the next read cold (scan runs)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the intake scan — we assert call count and control returned data.
vi.mock('./intake', () => ({
  listPendingTicketRequestsForSpaces: vi.fn(),
}));

import {
  readPendingRequestsSWR,
  removePendingFromCache,
  clearInboxRequestsCache,
  INBOX_REQUESTS_TTL_MS,
} from './intake-requests-cache';
import { listPendingTicketRequestsForSpaces } from './intake';
import { makeMockSession } from '../test-utils/mock-session';

// Fake PendingRequest shape — only the fields the cache accesses.
const req = (reqId: string, spaceId = 'sp-1') =>
  ({ req: { reqId, spaceId } }) as never;

const session = makeMockSession({ userId: 'u1' });
const spaceIds = new Set(['sp-1', 'sp-2']);
const scan = vi.mocked(listPendingTicketRequestsForSpaces);

beforeEach(() => {
  clearInboxRequestsCache();
  vi.clearAllMocks();
});

afterEach(() => {
  clearInboxRequestsCache();
});

describe('readPendingRequestsSWR — cold read', () => {
  it('awaits scan on first call and caches the result', async () => {
    scan.mockResolvedValue([req('r1')]);
    const result = await readPendingRequestsSWR(session, spaceIds);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(session, spaceIds);
    expect(result).toEqual([req('r1')]);
  });
});

describe('readPendingRequestsSWR — fresh (within TTL)', () => {
  it('serves cache on second call — scan called only once', async () => {
    scan.mockResolvedValue([req('r1'), req('r2')]);

    const first = await readPendingRequestsSWR(session, spaceIds);
    const second = await readPendingRequestsSWR(session, spaceIds);

    expect(scan).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

describe('readPendingRequestsSWR — stale (past TTL)', () => {
  it('returns stale data synchronously AND fires a background revalidation', async () => {
    // Seed the cache with an initial value.
    scan.mockResolvedValueOnce([req('r1')]);
    await readPendingRequestsSWR(session, spaceIds);
    expect(scan).toHaveBeenCalledTimes(1);

    // Fast-forward the module's `at` by manipulating Date.now for the next call.
    const origNow = Date.now;
    vi.stubGlobal('Date', { now: () => origNow() + INBOX_REQUESTS_TTL_MS + 1 });

    const onRevalidated = vi.fn();
    const fresh = [req('r1'), req('r2')];
    scan.mockResolvedValueOnce(fresh);

    // Should return stale immediately (one item).
    const stale = await readPendingRequestsSWR(session, spaceIds, onRevalidated);
    expect(stale).toEqual([req('r1')]);

    // Background revalidation hasn't called onRevalidated yet — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(scan).toHaveBeenCalledTimes(2);
    expect(onRevalidated).toHaveBeenCalledWith(fresh);

    vi.stubGlobal('Date', { now: origNow });
  });
});

describe('readPendingRequestsSWR — changed space-set', () => {
  it('bypasses TTL and runs a fresh scan when the space-set changes', async () => {
    scan.mockResolvedValue([req('r1')]);
    await readPendingRequestsSWR(session, new Set(['sp-1']));

    scan.mockResolvedValue([req('r2')]);
    const result = await readPendingRequestsSWR(session, new Set(['sp-1', 'sp-3']));

    expect(scan).toHaveBeenCalledTimes(2);
    expect(result).toEqual([req('r2')]);
  });
});

describe('removePendingFromCache', () => {
  it('drops the reqId from the cached snapshot so stale-serve does not resurrect it', async () => {
    scan.mockResolvedValue([req('r1'), req('r2')]);
    await readPendingRequestsSWR(session, spaceIds);

    removePendingFromCache(session.userId, 'r1');

    // Second read within TTL — should serve cache MINUS the removed entry.
    const result = await readPendingRequestsSWR(session, spaceIds);
    expect(result).toEqual([req('r2')]);
    expect(scan).toHaveBeenCalledTimes(1); // no new scan
  });

  it('is a no-op when the userId has no cached entry', () => {
    expect(() => removePendingFromCache('unknown-user', 'r1')).not.toThrow();
  });
});

describe('clearInboxRequestsCache', () => {
  it('makes the next read cold — scan runs again', async () => {
    scan.mockResolvedValue([req('r1')]);
    await readPendingRequestsSWR(session, spaceIds);
    expect(scan).toHaveBeenCalledTimes(1);

    clearInboxRequestsCache();

    scan.mockResolvedValue([req('r1'), req('r3')]);
    const result = await readPendingRequestsSWR(session, spaceIds);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(result).toEqual([req('r1'), req('r3')]);
  });
});
