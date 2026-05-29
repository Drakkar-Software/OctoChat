import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getOnline, reportReachability, subscribeOnline } from './connectivity';

describe('connectivity reportReachability', () => {
  // Reset to online between cases (the module holds a single shared flag).
  beforeEach(() => reportReachability(true));

  it('a failed request flips the signal offline; a success flips it back', () => {
    reportReachability(false);
    expect(getOnline()).toBe(false);
    reportReachability(true);
    expect(getOnline()).toBe(true);
  });

  it('notifies subscribers only on a CHANGE (deduped), and unsubscribes cleanly', () => {
    const cb = vi.fn();
    const off = subscribeOnline(cb);
    reportReachability(false); // true → false : fires
    reportReachability(false); // no change : silent
    reportReachability(true); //  false → true : fires
    expect(cb.mock.calls.map((c) => c[0])).toEqual([false, true]);
    off();
    reportReachability(false); // unsubscribed : no further calls
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
