/**
 * Live room-change SSE stream — shared types + a fetch-based reader used on both
 * web and native. The Starfish server's queuing plugin publishes one event per
 * successful push to the `chat` collection; the Whistlers NATS→SSE gateway
 * (`EVENTS_URL`) re-serves them as `text/event-stream`.
 *
 * We read the stream with `fetch` + a manual SSE parser rather than the browser
 * `EventSource`, because Whistlers emits NAMED events (`event: <topic>`) and
 * `EventSource.onmessage` only fires for the unnamed `message` type — named
 * events would be silently dropped. The fetch parser handles every `data:`
 * frame regardless of its `event:` name.
 *
 * Each event `data:` is JSON. Whistlers wraps the Starfish QueueMessage in an
 * envelope, so the payload is either the raw QueueMessage or `{ rawPayload: … }`:
 *     { collection: "chat", hash, timestamp, params: { spaceId, roomId } }   // raw
 *     { …, rawPayload: { …, params: { spaceId, roomId } } }                  // Whistlers
 *
 * Because chat docs are E2E-encrypted, an event can only carry the roomId (+ doc
 * hash + timestamp) — never a message id or author.
 */
import { EVENTS_URL } from './starfish/config';

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

const RECONNECT_MS = 3000;

/**
 * Subscribe to room-change events from `EVENTS_URL` via streaming `fetch`.
 * `onStatus(connected)` reports stream health so callers can fall back to
 * polling while disconnected. Returns an unsubscribe fn. Works on web and (best
 * effort) native — both have streaming `fetch`.
 */
export function subscribeRoomChanges(
  onChange: (e: RoomChange) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const controller = new AbortController();
  let closed = false;

  const emitFrame = (frame: string) => {
    // One SSE event may carry multiple `data:` lines; concatenate them.
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    const change = parseRoomChange(data);
    if (change) onChange(change);
  };

  void (async () => {
    while (!closed) {
      try {
        const res = await fetch(EVENTS_URL, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        const body = res.body as ReadableStream<Uint8Array> | null;
        if (!res.ok || !body) throw new Error(`SSE ${res.status}`);
        if (!closed) onStatus?.(true);
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            emitFrame(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
          }
        }
      } catch {
        if (closed) return;
      }
      if (!closed) {
        onStatus?.(false);
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    }
  })();

  return () => {
    closed = true;
    controller.abort();
  };
}
