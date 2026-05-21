/**
 * Shared types + parsing for the live room-change SSE stream. The Starfish
 * server's queuing plugin publishes one event per successful push to the `chat`
 * collection; an `/events` SSE endpoint broadcasts them as `text/event-stream`.
 *
 * The stream is served by the Whistlers NATS→SSE gateway (`EVENTS_URL`). Each
 * event `data:` is JSON. Whistlers wraps the Starfish QueueMessage in an
 * envelope, so the payload is either the raw QueueMessage or `{ rawPayload: … }`:
 *     { collection: "chat", hash, timestamp, params: { spaceId, roomId } }   // raw
 *     { …, rawPayload: { …, params: { spaceId, roomId } } }                  // Whistlers
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

interface QueueMessageish {
  params?: { roomId?: string; spaceId?: string };
  hash?: string;
  timestamp?: number;
}

/** Parse one SSE `data:` payload into a RoomChange, or null if not a chat change.
 *  Accepts both a raw QueueMessage and the Whistlers `{ rawPayload }` envelope. */
export function parseRoomChange(data: string): RoomChange | null {
  try {
    const d = JSON.parse(data) as QueueMessageish & { rawPayload?: QueueMessageish };
    const msg = d.params ? d : (d.rawPayload ?? d);
    const roomId = msg.params?.roomId;
    if (!roomId) return null;
    return { roomId, spaceId: msg.params?.spaceId, hash: msg.hash, ts: msg.timestamp };
  } catch {
    return null;
  }
}
