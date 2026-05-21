/**
 * Live room-change SSE subscription — web (native `EventSource`, auto-reconnects).
 * Native uses `events.native.ts`. Contract + parsing live in `events.shared.ts`.
 */
import { SYNC_BASE } from './starfish/config';
import { parseRoomChange, type RoomChange } from './events.shared';

export type { RoomChange } from './events.shared';

/** Subscribe to room-change events from `${SYNC_BASE}/events`. Returns unsubscribe. */
export function subscribeRoomChanges(onChange: (e: RoomChange) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  let es: EventSource;
  try {
    es = new EventSource(`${SYNC_BASE}/events`);
  } catch {
    return () => {};
  }
  es.onmessage = (ev: MessageEvent) => {
    const change = parseRoomChange(typeof ev.data === 'string' ? ev.data : '');
    if (change) onChange(change);
  };
  // EventSource reconnects itself on transient errors — nothing to do on error.
  return () => es.close();
}
