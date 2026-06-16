/**
 * Live room-change SSE stream — shared types + a fetch-based reader used on both
 * web and native. The Starfish server's queuing plugin publishes one event per
 * successful push to the `streamchat`/`streampub`/`streaminv` collections; the
 * Whistlers NATS→SSE gateway (`getEventsUrl()`) re-serves them as `text/event-stream`.
 *
 * We read the stream with `fetch` + a manual SSE parser rather than the browser
 * `EventSource`, because Whistlers emits NAMED events (`event: <topic>`) and
 * `EventSource.onmessage` only fires for the unnamed `message` type — named
 * events would be silently dropped. The fetch parser handles every `data:`
 * frame regardless of its `event:` name.
 *
 * Each event `data:` is JSON. Whistlers wraps the Starfish QueueMessage in an
 * envelope, so the payload is either the raw QueueMessage or `{ rawPayload: … }`:
 *     { collection: "streamchat", hash, timestamp, params: { spaceId, roomId } }   // raw
 *     { …, rawPayload: { …, params: { spaceId, roomId } } }                        // Whistlers
 *
 * Because chat docs are E2E-encrypted, an event carries the roomId (+ doc hash +
 * timestamp) but never a message id or its plaintext. It MAY carry `identity` — the
 * write author's account-level user id (sha256(edPub)[:16]) — when the server's
 * queuing plugin sets `includeIdentity` (OctoChat's does, for the same self-exclusion
 * the FCM bridge uses). That's metadata the server holds, not encrypted content, so
 * it's safe to forward; the client uses it to skip its own writes (see unread-context).
 *
 * Routing by collection: `streamchat`/`streampub`/`streaminv` carry `params.roomId`.
 * Index collections (`objindex`) carry only `spaceId` and are left to focus-pull.
 *
 * The generic transport (buildSignedEventsRequest / parseSseFrames / subscribeChanges)
 * lives in `@drakkar.software/octospaces-sdk`. This module is the OctoChat-specific
 * domain layer: `parseRoomChange` (the `parse` callback) + the `subscribeRoomChanges`
 * wrapper whose public signature the app consumer relies on.
 */
import { subscribeChanges } from '@drakkar.software/octospaces-sdk';

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
  /** roomId: OctoChat-local server (storagePath uses {roomId}).
   *  objectId: unified octospaces objlog (storagePath uses {objectId}).
   *  nodeId:   unified octospaces objpublog/objinvlog (storagePath uses {nodeId}). */
  params?: { roomId?: string; objectId?: string; nodeId?: string; spaceId?: string };
  hash?: string;
  timestamp?: number;
  identity?: string;
}

/** Parse one SSE `data:` payload into a RoomChange, or null if not a chat change.
 *  Accepts both a raw QueueMessage and the Whistlers `{ rawPayload }` envelope.
 *
 *  All stream collections (`streamchat`, `streampub`, `streaminv`) publish `params.roomId`. */
export function parseRoomChange(data: string): RoomChange | null {
  try {
    const d = JSON.parse(data) as QueueMessageish & { rawPayload?: QueueMessageish };
    const msg = d.params ? d : (d.rawPayload ?? d);
    // Accept the OctoChat-local param name (roomId) AND the unified octospaces
    // server param names (objectId for objlog, nodeId for objpublog/objinvlog).
    const roomId = msg.params?.roomId ?? msg.params?.objectId ?? msg.params?.nodeId;
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

// Fixed 3-second reconnect (both bounds equal → no exponential ramp-up).
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
 *
 * Delegates to the generic `subscribeChanges` from octospaces-sdk (which owns
 * the transport: mount-strip signing, %2C CDN encoding, SSE frame parsing, and
 * the reconnect loop). `parseRoomChange` is injected as the domain-specific
 * `parse` callback.
 */
export function subscribeRoomChanges(
  onChange: (e: RoomChange) => void,
  opts: SubscribeOptions,
): () => void {
  return subscribeChanges<RoomChange>({
    spaces: opts.spaces,
    authHeaders: opts.authHeaders,
    parse: parseRoomChange,
    onChange,
    onStatus: opts.onStatus,
    // Preserve OctoChat's existing fixed 3-second reconnect interval.
    minReconnectMs: RECONNECT_MS,
    maxReconnectMs: RECONNECT_MS,
  });
}
