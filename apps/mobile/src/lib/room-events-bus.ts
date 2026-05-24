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

export function emitSseStatus(up: boolean): void {
  sseUp = up;
  for (const l of statusListeners) l(up);
}

/**
 * Forget all registered room pulls and reset SSE health (on account switch). The
 * old session's room screens unmount and re-register under the new session;
 * `statusListeners` are React subscriptions that self-unsubscribe on unmount, so
 * they are intentionally left intact.
 */
export function clearRoomEventsBus(): void {
  pullRegistry.clear();
  sseUp = false;
}

/** Subscribe to SSE health changes. Fires immediately with the current state. */
export function onSseStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  cb(sseUp);
  return () => statusListeners.delete(cb);
}
