/**
 * reconcile-throttle — unit tests.
 *
 * Guards the module-level "run once per window" helper that replaced the fragile
 * per-component `useRef` throttles in `spaces-context.tsx` for the DM-inbox and
 * ticket-requests reconcile passes.
 *
 * The regression this suite targets: StrictMode double-invoke / Fast-Refresh / provider
 * remount reset the old `useRef` timestamps to 0, letting several concurrent `refresh()`
 * calls each enter `reconcileDmInbox` → `scanDmLinkInbox` → network. Each uncached
 * `?full=true` append-pull is a distinct GET, producing the observed 2–3× duplicate
 * inbox requests. The new guard is module-level, so remounts can't reset it.
 *
 * Uses `vi.useFakeTimers()` for controllable `Date.now()` and a deferred promise to
 * keep the in-flight window open across awaits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReconcileThrottle, runReconcileOncePerWindow } from './reconcile-throttle';

const TTL = 60_000; // mirrors RECONCILE_INTERVAL_MS in spaces-context

// ── helpers ──────────────────────────────────────────────────────────────────

/** Creates a promise that resolves only when `release()` is called — lets us keep
 *  the in-flight window open across multiple awaits. */
function deferred<T>(value: T): { promise: Promise<T>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<T>((resolve) => {
    release = () => resolve(value);
  });
  return { promise, release };
}

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  clearReconcileThrottle();
});

afterEach(() => {
  vi.useRealTimers();
  clearReconcileThrottle();
});

// ── test cases ────────────────────────────────────────────────────────────────

describe('runReconcileOncePerWindow', () => {
  it('1. first call runs fn and returns its result', async () => {
    const fn = vi.fn().mockResolvedValue(true);
    const result = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('2. second call within ttlMs skips fn and returns skipped', async () => {
    const fn = vi.fn().mockResolvedValue(true);
    await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    // advance but stay within the window
    vi.advanceTimersByTime(TTL - 1);
    const second = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(second).toBe(false); // skipped value
    expect(fn).toHaveBeenCalledTimes(1); // fn NOT called again
  });

  it('3. concurrent call while fn is in-flight is skipped without invoking fn (core fix)', async () => {
    // The regression: two refresh() calls fire before the first inbox pull completes.
    const { promise, release } = deferred(true);
    const fn = vi.fn().mockReturnValue(promise);

    // Fire the first call — fn runs, but the promise is still pending.
    const first = runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    // Fire a concurrent second call — must skip immediately.
    const second = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(second).toBe(false); // skipped
    expect(fn).toHaveBeenCalledTimes(1); // fn was NOT called a second time

    // Let the first call finish.
    release();
    const firstResult = await first;
    expect(firstResult).toBe(true);
  });

  it('4. runs again after the window has elapsed', async () => {
    const fn = vi.fn().mockResolvedValue(true);
    await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    vi.advanceTimersByTime(TTL); // advance exactly to the window boundary
    const second = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(second).toBe(true); // ran again
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('5. per-key isolation — different keys do not share throttle state', async () => {
    const fnDm = vi.fn().mockResolvedValue(true);
    const fnTickets = vi.fn().mockResolvedValue(true);

    await runReconcileOncePerWindow('dm:alice', TTL, fnDm, false);
    // tickets key is fresh — should run even though dm key is in cooldown
    const ticketsResult = await runReconcileOncePerWindow('tickets:alice', TTL, fnTickets, false);
    expect(ticketsResult).toBe(true);
    expect(fnDm).toHaveBeenCalledTimes(1);
    expect(fnTickets).toHaveBeenCalledTimes(1);
  });

  it('5b. per-user isolation — same key prefix but different userId do not interfere', async () => {
    const fnAlice = vi.fn().mockResolvedValue(true);
    const fnBob = vi.fn().mockResolvedValue(true);

    await runReconcileOncePerWindow('dm:alice', TTL, fnAlice, false);
    const bobResult = await runReconcileOncePerWindow('dm:bob', TTL, fnBob, false);
    expect(bobResult).toBe(true);
    expect(fnAlice).toHaveBeenCalledTimes(1);
    expect(fnBob).toHaveBeenCalledTimes(1);
  });

  it('6. fn rejection propagates, inflight is released, lastDone is stamped', async () => {
    const err = new Error('network error');
    const fn = vi.fn().mockRejectedValue(err);

    // First call: fn rejects, error must propagate.
    await expect(runReconcileOncePerWindow('dm:alice', TTL, fn, false)).rejects.toThrow('network error');
    expect(fn).toHaveBeenCalledTimes(1);

    // Within the window: next call skips (no retry storm).
    vi.advanceTimersByTime(TTL - 1);
    const second = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(second).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1); // still 1 — skipped

    // After the window: next call runs again.
    vi.advanceTimersByTime(2); // push past TTL
    const fn2 = vi.fn().mockResolvedValue(true);
    const third = await runReconcileOncePerWindow('dm:alice', TTL, fn2, false);
    expect(third).toBe(true);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('7. clearReconcileThrottle() allows an immediate re-run', async () => {
    const fn = vi.fn().mockResolvedValue(true);
    await runReconcileOncePerWindow('dm:alice', TTL, fn, false);

    // Within cooldown — would normally skip.
    vi.advanceTimersByTime(1);
    const before = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(before).toBe(false); // skipped as expected

    clearReconcileThrottle();

    // After clear — must run again regardless of the remaining cooldown.
    const after = await runReconcileOncePerWindow('dm:alice', TTL, fn, false);
    expect(after).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
