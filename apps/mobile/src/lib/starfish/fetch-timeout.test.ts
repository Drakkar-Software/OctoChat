import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from './fetch-timeout';

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

describe('fetchWithTimeout', () => {
  it('aborts and rejects when the request never responds within the timeout', async () => {
    vi.useFakeTimers();
    // A fetch that never resolves on its own — it only ever settles by rejecting
    // when its signal aborts (the real RN failure mode: a stalled socket).
    globalThis.fetch = vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const p = fetchWithTimeout(5_000)('http://x');
    const assertion = expect(p).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(5_000); // fire the connect timer → ctrl.abort()
    await assertion;
  });

  it('resolves and clears the timer when the response arrives in time', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const resp = { ok: true } as Response;
    globalThis.fetch = vi.fn(async () => resp) as unknown as typeof fetch;

    const r = await fetchWithTimeout(5_000)('http://x');
    expect(r).toBe(resp);
    expect(clearSpy).toHaveBeenCalled(); // timer cleared once fetch() settled
  });

  it('aborts the underlying request when the caller signal aborts', async () => {
    const caller = new AbortController();
    let observed: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
      observed = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const p = fetchWithTimeout(60_000)('http://x', { signal: caller.signal });
    const assertion = expect(p).rejects.toThrow('aborted');
    caller.abort(); // composed: caller abort → inner controller abort
    await assertion;
    expect(observed).not.toBe(caller.signal); // wrapper passes its OWN signal, not the caller's
  });
});
