/**
 * Live room-change SSE stream — shared types + a fetch-based reader used on both
 * web and native. The Starfish server's queuing plugin publishes one event per
 * successful push to the `chat` collection; the Whistlers NATS→SSE gateway
 * (`getEventsUrl()`) re-serves them as `text/event-stream`.
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
 * Because chat docs are E2E-encrypted, an event carries the roomId (+ doc hash +
 * timestamp) but never a message id or its plaintext. It MAY carry `identity` — the
 * write author's account-level user id (sha256(edPub)[:16]) — when the server's
 * queuing plugin sets `includeIdentity` (OctoChat's does, for the same self-exclusion
 * the FCM bridge uses). That's metadata the server holds, not encrypted content, so
 * it's safe to forward; the client uses it to skip its own writes (see unread-context).
 *
 * Routing by collection: `chat`/`streamchat`/`pubstream` carry `params.roomId`.
 * Public channels (`pubspace`) instead carry `params.docId` (the room id, or
 * `_rooms` for the public room registry) — we route on that and SKIP `_rooms`,
 * which is a registry write, not a room.
 */
import { getEventsUrl, getSyncBase } from '../config/config';

export interface RoomChange {
  roomId: string;
  spaceId?: string;
  hash?: string;
  ts?: number;
  /** Account-level user id of the write's author (sha256(edPub)[:16]), when the
   *  server forwards it (`includeIdentity`). Absent on servers that don't — callers
   *  must treat undefined as "author unknown". */
  identity?: string;
}

interface QueueMessageish {
  collection?: string;
  params?: { roomId?: string; docId?: string; spaceId?: string; objectId?: string };
  hash?: string;
  timestamp?: number;
  identity?: string;
}

/** Unified-object content collections — their change events key the changed doc by
 *  `params.objectId` (a doc/project id), which we map onto `roomId` so the existing
 *  per-room live-sync bus (keyed on roomId) drives a pull. The index collections
 *  (`objindex`/`pubobjindex`) carry only `spaceId` (no objectId) — no per-doc
 *  subscriber, so they're left to focus-pull and routed as null here. */
const OBJECT_CONTENT_COLLECTIONS = new Set(['objdoc', 'objlog', 'pubobjdoc', 'pubobjlog']);

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
    } else if (msg.collection && OBJECT_CONTENT_COLLECTIONS.has(msg.collection)) {
      // Doc/project content: key by objectId so the per-doc live-sync fires.
      roomId = msg.params?.objectId;
    } else {
      roomId = msg.params?.roomId;
    }
    if (!roomId) return null;
    return {
      roomId,
      spaceId: msg.params?.spaceId,
      hash: msg.hash,
      ts: msg.timestamp,
      identity: typeof msg.identity === 'string' ? msg.identity : undefined,
    };
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
 * Subscribe to room-change events from `getEventsUrl()` via streaming `fetch`.
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
        const eventsUrl = new URL(getEventsUrl());
        eventsUrl.searchParams.set('spaces', opts.spaces.join(','));
        // Sign the path the SERVER observes: strip getSyncBase()'s mount path (e.g.
        // "/sync", which nginx rewrites away) so the signed pathAndQuery matches
        // the server's post-rewrite request path. Mirrors how StarfishClient signs
        // the endpoint path, not the baseUrl path. (Host is bound from getSyncBase() in
        // buildAuthHeaders, so it already agrees with the server's Host header.)
        const basePath = new URL(getSyncBase()).pathname.replace(/\/+$/, '');
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
