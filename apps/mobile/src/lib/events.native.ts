/**
 * Live room-change SSE subscription — native. Shares the fetch-based reader in
 * `events.shared.ts` with web (React Native's `fetch` exposes a streaming body;
 * best-effort — swap in `react-native-sse` if it proves unreliable on a device).
 */
export { subscribeRoomChanges } from './events.shared';
export type { RoomChange } from './events.shared';
