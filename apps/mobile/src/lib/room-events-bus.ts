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
// Multiple consumers (useObjects instances) may mount for the same spaceId but
// they all share ONE underlying merge-doc store. This refcounted registry stores
// ONE pull function per spaceId (the first registrant's) and counts active
// consumers so the entry survives partial unmounts without firing redundant pulls.

interface IndexEntry { pull: PullFn; count: number }
const indexPullRegistry = new Map<string, IndexEntry>();

/**
 * Register a pull for the object-index of `spaceId`. Only the FIRST registrant's
 * fn is stored; subsequent ones increment the refcount (all consumers share the
 * same store, so any pull fn is equivalent). Returns an unsubscribe fn.
 */
export function registerIndexPull(spaceId: string, fn: PullFn): () => void {
  const entry = indexPullRegistry.get(spaceId);
  if (entry) {
    entry.count++;
  } else {
    indexPullRegistry.set(spaceId, { pull: fn, count: 1 });
  }
  return () => {
    const e = indexPullRegistry.get(spaceId);
    if (!e) return;
    if (e.count <= 1) {
      indexPullRegistry.delete(spaceId);
    } else {
      e.count--;
    }
  };
}

/**
 * Trigger a pull of the object-index for `spaceId` (e.g. after a headless write
 * that bypassed the store, like an accepted ticket request or an SSE index-change).
 * Returns true if a pull was registered and fired; false if no consumer is mounted.
 */
export function dispatchIndexChange(spaceId: string): boolean {
  const entry = indexPullRegistry.get(spaceId);
  if (!entry) return false;
  entry.pull();
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
