/**
 * Live room-change SSE subscription. Web and native share the fetch-based reader
 * in `events.shared.ts` (Whistlers emits named SSE events, which the browser
 * `EventSource.onmessage` would drop — the fetch parser handles them).
 */
export { subscribeRoomChanges } from './events.shared';
export type { RoomChange } from './events.shared';
