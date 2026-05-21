/**
 * Module-level singleton that bridges the global SSE subscription
 * (UnreadProvider) to per-room consumers (use-room). Avoids a second SSE
 * connection per open room — the global connection already covers all the
 * user's spaces, so use-room just listens here instead of opening its own.
 */

type RoomChangeListener = (roomId: string) => void;
type StatusListener = (up: boolean) => void;

const changeListeners = new Set<RoomChangeListener>();
const statusListeners = new Set<StatusListener>();
let sseUp = false;

export function emitRoomChange(roomId: string): void {
  for (const l of changeListeners) l(roomId);
}

export function emitSseStatus(up: boolean): void {
  sseUp = up;
  for (const l of statusListeners) l(up);
}

export function onRoomChange(cb: RoomChangeListener): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/** Subscribe to SSE health changes. Fires immediately with the current state. */
export function onSseStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  cb(sseUp);
  return () => statusListeners.delete(cb);
}
