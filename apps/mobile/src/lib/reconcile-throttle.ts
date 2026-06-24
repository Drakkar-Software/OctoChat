/**
 * Module-level "run once per window" guard for expensive reconcile passes
 * (DM-inbox scan, ticket-request reconcile).
 *
 * ## Why not useRef throttles?
 * Both reconcile passes were previously guarded by per-component `useRef` timestamps.
 * Those guards fail when `SpacesProvider` remounts (React StrictMode double-invoke,
 * Fast-Refresh/HMR in dev, account switch) because the refs reset to 0, letting
 * every concurrent `refresh()` call through simultaneously. Each uncached
 * append-pull (`?full=true` / `appendField` bypasses the pull-cache) then fires a
 * fresh network request — producing the observed 2–3× duplicate inbox GETs.
 *
 * ## Design vs. node-access-cache.ts
 * `node-access-cache.ts` lets concurrent callers JOIN one in-flight promise because
 * the result is a pure cached value. The reconcile passes have side effects: after
 * `reconcileDmInbox` returns `true`, the caller runs `healDmMap`/`healDmRosters`;
 * after `reconcileTicketRequests` returns `true`, it dispatches index updates.
 * Concurrent callers must therefore SKIP (receive `skipped`) rather than join, so
 * heals and dispatch run exactly once. The first caller to check-and-claim (a
 * synchronous JS set-write — no preemption between coroutines) becomes the runner;
 * the rest skip immediately.
 *
 * ## Guards
 * Two guards cooperate:
 * - `inflight`  — while `fn` is running (before `lastDone` is stamped). Handles the
 *                 "several refresh() calls fire before the first inbox pull completes"
 *                 case that was the primary source of duplicates.
 * - `lastDone`  — cooldown after `fn` resolves. Prevents re-runs within `ttlMs` even
 *                 when there is no in-flight call (e.g. repeated AppState foreground
 *                 events spaced more than a network round-trip apart).
 *
 * Keys are user-scoped (`dm:<userId>`, `tickets:<userId>`) so different accounts never
 * share throttle state. Call {@link clearReconcileThrottle} on account switch /
 * sign-out alongside the other module-level cache clears.
 */

const inflight = new Set<string>();
const lastDone = new Map<string, number>();

/**
 * Run `fn` at most once per `ttlMs` per `key`. Concurrent callers while `fn` is
 * in-flight return `skipped` immediately without invoking `fn`. Subsequent callers
 * within `ttlMs` of a completed run also return `skipped`. A call after the window
 * has elapsed becomes the next runner.
 *
 * On rejection, the error propagates, `inflight` is released, and `lastDone` is
 * stamped — so the next call within `ttlMs` skips (no retry storm) and one after the
 * window runs normally.
 */
export async function runReconcileOncePerWindow<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  skipped: T,
): Promise<T> {
  if (inflight.has(key)) return skipped;
  if (Date.now() - (lastDone.get(key) ?? 0) < ttlMs) return skipped;
  inflight.add(key);
  try {
    return await fn();
  } finally {
    lastDone.set(key, Date.now());
    inflight.delete(key);
  }
}

/** Reset all throttle state. Call on account switch / sign-out. */
export function clearReconcileThrottle(): void {
  inflight.clear();
  lastDone.clear();
}
