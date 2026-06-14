/**
 * The "webhook trigger" half of the bot: subscribe to the Starfish `/events` SSE
 * stream and call `onChange` once per room-change event.
 *
 * This is a Node port of the app's `apps/mobile/src/lib/events.shared.ts`, trimmed
 * to what a bot needs. Two things matter for getting authorized:
 *
 *   1. `/events` requires cap-cert auth and REJECTS audience caps (it needs a cap
 *      with a concrete subject so the per-request signature is attributable — see
 *      apps/server/src/events.ts `if (!cert.sub) return null`). So the bot CANNOT
 *      listen with its stream-bot token (that's an audience cap). It listens with a
 *      read-only PUBLIC-space invite link, which carries a `member` cap + the
 *      ephemeral subject key the link was minted against. We sign each connect with
 *      that key, exactly like the app's hand-rolled `buildAuthHeaders`.
 *
 *   2. `?spaces=` declares which spaces we want events for. A space whose invite link
 *      was minted by the owner is open-gated for that member cap — no extra config.
 *
 * Each event carries only `{ roomId, spaceId?, hash?, ts? }` — never message
 * content (chat is E2E-encrypted and even public events omit the body). The trigger
 * is "room X changed"; reacting to it is the caller's job.
 */
import { signRequest, stableStringify } from '@drakkar.software/starfish-protocol';
import type { SignableMethod } from '@drakkar.software/starfish-protocol';

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

/** Parse one SSE `data:` payload into a RoomChange, or null if it isn't a chat
 *  change. Accepts both the raw Starfish QueueMessage and the Whistlers
 *  `{ rawPayload }` envelope. Room changes carry `params.roomId` in all three
 *  stream tiers (streamchat, streampub, streaminv). */
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

/** Build the cap-cert auth headers `/events` expects for a MEMBER cap, signing the
 *  observed path with the link's ephemeral subject key. Mirrors the app's
 *  `buildAuthHeaders` (client.ts) — `signRequest` defaults to ed25519 and folds the
 *  suite name into the signed input, returned as `alg`. */
async function memberAuthHeaders(
  cap: unknown,
  signingKeyHex: string,
  method: SignableMethod,
  pathAndQuery: string,
  host: string,
): Promise<Record<string, string>> {
  const { alg, sig, ts, nonce } = await signRequest({ method, pathAndQuery, host }, signingKeyHex);
  const capB64 = Buffer.from(stableStringify(cap as Record<string, unknown>), 'utf-8').toString('base64');
  return {
    Authorization: `Cap ${capB64}`,
    'X-Starfish-Sig': sig,
    'X-Starfish-Ts': String(ts),
    'X-Starfish-Nonce': nonce,
    'X-Starfish-Alg': alg,
  };
}

export interface SubscribeOptions {
  /** Sync base URL (may include a mount path, e.g. `https://host/sync`). */
  serverUrl: string;
  /** Bare namespace (e.g. `octochat`) or '' for the root-mounted local dev server. */
  namespace: string;
  /** Candidate space ids to request events for (the space the invite link was minted for). */
  spaces: string[];
  /** The invite link's `member` cap-cert and the ephemeral key it was minted against. */
  cap: unknown;
  signingKeyHex: string;
  onChange: (e: RoomChange) => void;
  /** Reports stream health (true = connected, false = reconnecting). */
  onStatus?: (connected: boolean) => void;
}

const RECONNECT_MS = 3000;

/**
 * Open the SSE stream and pump room-change events to `onChange` until the returned
 * unsubscribe fn is called. Reconnects on drop. Uses `fetch` + a manual SSE parser
 * (not `EventSource`) because Whistlers emits NAMED events that `EventSource`
 * silently drops.
 */
export function subscribeRoomChanges(opts: SubscribeOptions): () => void {
  const prefix = opts.namespace ? `/v1/${opts.namespace}` : '';
  const eventsUrl = new URL(`${opts.serverUrl.replace(/\/+$/, '')}${prefix}/events`);
  eventsUrl.searchParams.set('spaces', opts.spaces.join(','));

  // Sign the path the SERVER observes: strip the serverUrl mount (e.g. `/sync`,
  // which nginx rewrites away) so the signed pathAndQuery matches the server's
  // post-rewrite request path. Host is bound from serverUrl so both sides agree.
  const basePath = new URL(opts.serverUrl).pathname.replace(/\/+$/, '');
  const signedPath =
    basePath && eventsUrl.pathname.startsWith(basePath)
      ? eventsUrl.pathname.slice(basePath.length)
      : eventsUrl.pathname;
  const pathAndQuery = signedPath + eventsUrl.search;
  const host = new URL(opts.serverUrl).host;

  const controller = new AbortController();
  let closed = false;

  const emitFrame = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    const change = parseRoomChange(data);
    if (change) opts.onChange(change);
  };

  void (async () => {
    while (!closed) {
      try {
        // Fresh auth headers each attempt (new nonce + timestamp).
        const headers = await memberAuthHeaders(opts.cap, opts.signingKeyHex, 'GET', pathAndQuery, host);
        const res = await fetch(eventsUrl.toString(), {
          headers: { Accept: 'text/event-stream', ...headers },
          signal: controller.signal,
        });
        const body = res.body as ReadableStream<Uint8Array> | null;
        if (!res.ok || !body) throw new Error(`SSE ${res.status} ${await res.text().catch(() => '')}`);
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
