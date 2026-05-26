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
 *
 * Routing by collection: `chat`/`streamchat`/`pubstream` carry `params.roomId`.
 * Public channels (`pubspace`) instead carry `params.docId` (the room id, or
 * `_rooms` for the public room registry) — we route on that and SKIP `_rooms`,
 * which is a registry write, not a room.
 */
import { EVENTS_URL, SYNC_BASE } from './starfish/config';

export interface RoomChange {
  roomId: string;
  spaceId?: string;
  hash?: string;
  ts?: number;
}

interface QueueMessageish {
  collection?: string;
  params?: { roomId?: string; docId?: string; spaceId?: string };
  hash?: string;
  timestamp?: number;
}

/** Parse one SSE `data:` payload into a RoomChange, or null if not a chat change.
 *  Accepts both a raw QueueMessage and the Whistlers `{ rawPayload }` envelope. */
export function parseRoomChange(data: string): RoomChange | null {
  try {
    const d = JSON.parse(data) as QueueMessageish & { rawPayload?: QueueMessageish };
    const msg = d.params ? d : (d.rawPayload ?? d);
    // Public channels (`pubspace`) key the changed doc as `docId`, not `roomId`;
    // `docId === '_rooms'` is the room-registry write (not a room) and must NOT
    // route a pull or bump a phantom unread. Every other publisher uses `roomId`.
    let roomId: string | undefined;
    if (msg.collection === 'pubspace') {
      const docId = msg.params?.docId;
      if (!docId || docId === '_rooms') return null;
      roomId = docId;
    } else {
      roomId = msg.params?.roomId;
    }
    if (!roomId) return null;
    return { roomId, spaceId: msg.params?.spaceId, hash: msg.hash, ts: msg.timestamp };
  } catch {
    return null;
  }
}

const RECONNECT_MS = 3000;

/** Options for {@link subscribeRoomChanges}. */
export interface SubscribeOptions {
  /**
   * Candidate space ids to subscribe to. The server validates each against
   * the caller's membership and only forwards events for authorized spaces.
   */
  spaces: string[];
  /**
   * Async function that builds cap-cert auth headers for the SSE fetch.
   * Called on every connect/reconnect so each attempt gets a fresh nonce.
   */
  authHeaders: (method: string, pathAndQuery: string) => Promise<Record<string, string>>;
  /** Reports stream health (true = connected, false = disconnected/reconnecting). */
  onStatus?: (connected: boolean) => void;
}

/**
 * Subscribe to room-change events from `EVENTS_URL` via streaming `fetch`.
 * Sends the caller's authorized candidate spaces and cap-cert auth headers so
 * the server proxy can filter by membership. Returns an unsubscribe fn.
 * Works on web and (best effort) native — both have streaming `fetch`.
 */
export function subscribeRoomChanges(
  onChange: (e: RoomChange) => void,
  opts: SubscribeOptions,
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
        // Build the URL with the candidate spaces param.
        const eventsUrl = new URL(EVENTS_URL);
        eventsUrl.searchParams.set('spaces', opts.spaces.join(','));
        // Sign the path the SERVER observes: strip SYNC_BASE's mount path (e.g.
        // "/sync", which nginx rewrites away) so the signed pathAndQuery matches
        // the server's post-rewrite request path. Mirrors how StarfishClient signs
        // the endpoint path, not the baseUrl path. (Host is bound from SYNC_BASE in
        // buildAuthHeaders, so it already agrees with the server's Host header.)
        const basePath = new URL(SYNC_BASE).pathname.replace(/\/+$/, '');
        const signedPath =
          basePath && eventsUrl.pathname.startsWith(basePath)
            ? eventsUrl.pathname.slice(basePath.length)
            : eventsUrl.pathname;
        const pathAndQuery = signedPath + eventsUrl.search;
        // Auth headers are built fresh each attempt (new nonce + timestamp).
        const extraHeaders = await opts.authHeaders('GET', pathAndQuery);
        const res = await fetch(eventsUrl.toString(), {
          headers: { Accept: 'text/event-stream', ...extraHeaders },
          signal: controller.signal,
        });
        const body = res.body as ReadableStream<Uint8Array> | null;
        if (!res.ok || !body) throw new Error(`SSE ${res.status}`);
        if (!closed) opts.onStatus?.(true);
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
        opts.onStatus?.(false);
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    }
  })();

  return () => {
    closed = true;
    controller.abort();
  };
}
