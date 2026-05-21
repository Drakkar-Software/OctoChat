/**
 * Shared types + parsing for the live room-change SSE stream. The Starfish
 * server's queuing plugin publishes one event per successful push to the `chat`
 * collection; an `/events` SSE endpoint broadcasts them as `text/event-stream`.
 *
 * Assumed server contract (see satellite `examples/app/backend/server.py`):
 *   GET ${SYNC_BASE}/events  →  text/event-stream
 *   each event `data:` is a QueueMessage JSON object:
 *     { collection: "chat", hash, timestamp, params: { spaceId, roomId } }
 *
 * Because chat docs are E2E-encrypted, an event can only carry the roomId (+ doc
 * hash + timestamp) — never a message id or author.
 */
export interface RoomChange {
  roomId: string;
  spaceId?: string;
  hash?: string;
  ts?: number;
}

/** Parse one SSE `data:` payload into a RoomChange, or null if not a chat change. */
export function parseRoomChange(data: string): RoomChange | null {
  try {
    const d = JSON.parse(data) as {
      params?: { roomId?: string; spaceId?: string };
      hash?: string;
      timestamp?: number;
    };
    const roomId = d.params?.roomId;
    if (!roomId) return null;
    return { roomId, spaceId: d.params?.spaceId, hash: d.hash, ts: d.timestamp };
  } catch {
    return null;
  }
}
