/**
 * The "push as a bot" half: append one event to a PUBLIC stream room.
 *
 * A stream room is an append-only log, so posting is a single signed POST `/push`
 * — no pull / merge / hash. The bot is authorized by the owner-minted stream-bot
 * token, which is a Starfish `createPublicLink` AUDIENCE cap (no embedded secret):
 * the bot generates its OWN keypair and signs each request with it, naming that key
 * via `X-Starfish-Pub` (`redeemPublicLink`). A leaked token is therefore useless to
 * anyone who can't also sign — and writes stay attributable per bot.
 *
 * The app's `StarfishClient.append` only knows the member-cap header flow, so it
 * can't drive an audience redemption; that's why `stream-bots.ts` hands the owner a
 * raw `endpoint` + `signPath` and the bot POSTs by hand. We reproduce
 * `StarfishClient.append`'s exact wire format (`body = JSON.stringify({ data })`,
 * `Content-Type: application/json`) so the server accepts it identically.
 */
import { parsePublicLink, redeemPublicLink } from '@drakkar.software/starfish-sharing';

/** A fresh keypair the bot redeems the token with (hex Ed25519). */
export interface Redeemer {
  edPubHex: string;
  edPrivHex: string;
}

export interface AppendOptions {
  /** Sync base URL (may include a mount path, e.g. `https://host/sync`). */
  serverUrl: string;
  /** Bare namespace (e.g. `octochat`) or '' for the root-mounted local dev server. */
  namespace: string;
  /** The stream-bot token (audience-cap fragment) from the app's "Connect a bot" panel. */
  botToken: string;
  /** The panel's "Path to sign" — `/push/pubspaces/<owner>/<space>/streams/<room>`,
   *  un-namespaced (the namespace prefix is applied here). */
  signPath: string;
  /** The keypair this bot signs with. */
  redeemer: Redeemer;
}

/**
 * Append `element` to the stream. `element` is the payload the room renders — for
 * the OctoChat chat UI that's a typed envelope, e.g.
 * `{ t: 'msg', e: { id, authorId, ts, text } }` (see message-view.ts / use-stream-room.ts).
 * The server stamps each appended element with an authoritative `{ ts }`, so we send
 * none (omitting `ts` avoids any monotonic-timestamp 409 on concurrent appends).
 */
export async function appendToStream(opts: AppendOptions, element: Record<string, unknown>): Promise<void> {
  // The path the server observes: namespace prefix + the panel's action path. We
  // sign THIS exact string and POST it under the serverUrl (whose mount, e.g.
  // `/sync`, nginx strips before the server sees the signed path) — matching how
  // StarfishClient signs `applyNamespace(path)` while POSTing `baseUrl + that`.
  const actionPath = (opts.namespace ? `/v1/${opts.namespace}` : '') + opts.signPath;
  const url = `${opts.serverUrl.replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(opts.serverUrl).host;

  // Exact `StarfishClient.append` body: the element wrapped as `{ data }`.
  const body = JSON.stringify({ data: element });

  const parsed = parsePublicLink(opts.botToken);
  const redeemHeaders = await redeemPublicLink(parsed, {
    redeemerEdPrivHex: opts.redeemer.edPrivHex,
    redeemerEdPubHex: opts.redeemer.edPubHex,
    method: 'POST',
    pathAndQuery: actionPath,
    body, // signed bytes MUST equal the bytes sent on the wire
    host,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...redeemHeaders },
    body,
  });
  if (!res.ok) {
    throw new Error(`append failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}
