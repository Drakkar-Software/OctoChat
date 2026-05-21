/**
 * Live room-change SSE subscription — web (native `EventSource`, auto-reconnects).
 * Native uses `events.native.ts`. Contract + parsing live in `events.shared.ts`.
 */
import { EVENTS_URL } from './starfish/config';
import { parseRoomChange, type RoomChange } from './events.shared';

export type { RoomChange } from './events.shared';

/**
 * Subscribe to room-change events from the Whistlers SSE endpoint (`EVENTS_URL`).
 * `onStatus(connected)` reports stream health so callers can fall back to
 * polling while disconnected. Returns an unsubscribe fn.
 */
export function subscribeRoomChanges(
  onChange: (e: RoomChange) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  let es: EventSource;
  try {
    es = new EventSource(EVENTS_URL);
  } catch {
    return () => {};
  }
  es.onopen = () => onStatus?.(true);
  es.onmessage = (ev: MessageEvent) => {
    const change = parseRoomChange(typeof ev.data === 'string' ? ev.data : '');
    if (change) onChange(change);
  };
  // EventSource reconnects itself; onerror marks "down" until onopen fires again.
  es.onerror = () => onStatus?.(false);
  return () => es.close();
}
