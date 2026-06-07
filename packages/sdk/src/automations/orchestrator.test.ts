import { describe, expect, it } from 'vitest';

import { tickStatusPatch } from './orchestrator';

// tickStatusPatch is the load-bearing link: its output is written to BOTH the
// server doc AND the optimistic local cache, so a posted scheduled tick must carry
// `lastFetchHash` forward — without it the next open re-hashes a stale cursor and
// reposts. These cases pin that the cursor rides the patch (and only when posted).
describe('tickStatusPatch', () => {
  const now = 5_000;

  it('a posted scheduled tick carries lastFetchHash + advances lastRunAt', () => {
    expect(tickStatusPatch({ kind: 'posted', text: 'x', hash: 'abc123' }, now)).toEqual({
      lastRunAt: now,
      lastError: null,
      lastFetchHash: 'abc123',
    });
  });

  it('a command post (no hash) advances lastRunAt but never sets lastFetchHash', () => {
    expect(tickStatusPatch({ kind: 'posted', text: 'x' }, now)).toEqual({
      lastRunAt: now,
      lastError: null,
    });
  });

  it('a skip advances lastRunAt + clears the error, no hash', () => {
    expect(tickStatusPatch({ kind: 'skipped' }, now)).toEqual({ lastRunAt: now, lastError: null });
  });

  it('a failure records only the error — lastRunAt + cursor untouched', () => {
    expect(tickStatusPatch({ kind: 'failed', error: 'boom' }, now)).toEqual({ lastError: 'boom' });
  });
});
