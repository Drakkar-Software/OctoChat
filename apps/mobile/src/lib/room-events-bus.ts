/**
 * Single dispatch point for room-change events from the global SSE connection.
 *
 * When an event arrives, UnreadProvider calls dispatchRoomChange(roomId):
 *   - if use-room has registered a pull for that roomId → call it (the user is
 *     actively viewing the room) and return true — caller skips unread bump.
 *   - otherwise return false → caller bumps unread.
 *
 * use-room registers/unregisters its pull via registerPull. SSE health is
 * broadcast via emitSseStatus so use-room can gate its fallback polling.
 *
 * Object-index changes (node create/rename) are dispatched via the separate
 * refcounted index registry: registerIndexPull / dispatchIndexChange.
 */

type PullFn = () => void;
type StatusListener = (up: boolean) => void;

const pullRegistry = new Map<string, PullFn>();
const statusListeners = new Set<StatusListener>();
let sseUp = false;

/** Register a pull function for roomId. Returns an unsubscribe fn. */
export function registerPull(roomId: string, fn: PullFn): () => void {
  pullRegistry.set(roomId, fn);
  return () => { if (pullRegistry.get(roomId) === fn) pullRegistry.delete(roomId); };
}

/**
 * Dispatch a room-change event. If a pull is registered for roomId, calls it
 * (the user is viewing that room) and returns true. Returns false otherwise.
 */
export function dispatchRoomChange(roomId: string): boolean {
  const pull = pullRegistry.get(roomId);
  if (!pull) return false;
  pull();
  return true;
}

// ── Object-index pull registry ────────────────────────────────────────────────
// Multiple consumers (useObjects instances) may mount for the same spaceId; they
// share ONE underlying merge-doc store. Each consumer registers its own pull fn
// here. When `useObjects`'s pull identity flips from a no-op (null-store window on
// first render) to a real pull (store ready), the effect cleanup removes the no-op
// and re-registers the real fn — ensuring dispatchIndexChange never calls a stale
// no-op that leaves the Tickets list un-repainted after an accept or SSE event.

const indexPullRegistry = new Map<string, Set<PullFn>>();

/**
 * Register a pull fn for the object-index of `spaceId`. Each registrant gets its
 * own slot in a per-spaceId Set so the most-recent (real) pull fn is always
 * included. Returns an unsubscribe fn that removes only this fn from the set.
 */
export function registerIndexPull(spaceId: string, fn: PullFn): () => void {
  let set = indexPullRegistry.get(spaceId);
  if (!set) {
    set = new Set();
    indexPullRegistry.set(spaceId, set);
  }
  set.add(fn);
  return () => {
    const s = indexPullRegistry.get(spaceId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) indexPullRegistry.delete(spaceId);
  };
}

/**
 * Trigger a pull of the object-index for `spaceId` (e.g. after a headless write
 * that bypassed the store, like an accepted ticket request or an SSE index-change).
 * Calls ALL registered pull fns (idempotent: they all share the same store).
 * Returns true if at least one pull was fired; false if no consumer is mounted.
 */
export function dispatchIndexChange(spaceId: string): boolean {
  const set = indexPullRegistry.get(spaceId);
  if (!set || set.size === 0) return false;
  for (const fn of set) fn();
  return true;
}

export function emitSseStatus(up: boolean): void {
  sseUp = up;
  for (const l of statusListeners) l(up);
}

/**
 * Forget all registered pulls and reset SSE health (on account switch). The
 * old session's room screens unmount and re-register under the new session;
 * `statusListeners` are React subscriptions that self-unsubscribe on unmount, so
 * they are intentionally left intact.
 */
export function clearRoomEventsBus(): void {
  pullRegistry.clear();
  indexPullRegistry.clear();
  sseUp = false;
}

/** Subscribe to SSE health changes. Fires immediately with the current state. */
export function onSseStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  cb(sseUp);
  return () => statusListeners.delete(cb);
}
