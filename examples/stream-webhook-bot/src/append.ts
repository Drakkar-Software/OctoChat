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
import { signAppendAuthor } from '@drakkar.software/starfish-protocol';

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
  /** The stream-bot token (audience-cap fragment) from the app's "Connect a bot" panel.
   *  @deprecated The audience-cap bot flow is no longer supported. Use webhooks instead
   *  (owner creates a webhook URL in the room's settings; POST to it with the token header). */
  botToken: string;
  /** The "Path to sign" — `/push/spaces/<spaceId>/streams/pub/<roomId>`,
   *  un-namespaced (the namespace prefix is applied here). */
  signPath: string;
  /** The keypair this bot signs with. */
  redeemer: Redeemer;
}

/** The namespace-prefixed action path the server observes (the serverUrl mount,
 *  e.g. `/sync`, is stripped by nginx before the server sees this signed path) —
 *  matching how StarfishClient signs `applyNamespace(path)` while sending `baseUrl + that`. */
function actionPathFor(opts: AppendOptions, signPath: string): string {
  return (opts.namespace ? `/v1/${opts.namespace}` : '') + signPath;
}

/**
 * Append `element` to the stream. `element` is the payload the room renders — for
 * the OctoChat chat UI that's a typed envelope, e.g.
 * `{ t: 'msg', e: { id, authorId, ts, text } }` (see message-view.ts / use-stream-room.ts).
 * The server stamps each appended element with an authoritative `{ ts }`, so we send
 * none (omitting `ts` avoids any monotonic-timestamp 409 on concurrent appends).
 */
export async function appendToStream(opts: AppendOptions, element: Record<string, unknown>): Promise<void> {
  const actionPath = actionPathFor(opts, opts.signPath);
  const url = `${opts.serverUrl.replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(opts.serverUrl).host;

  // Author proof (required by `requireAuthorSignature`, on by default since
  // Starfish alpha.8): sign the element bound to the storage `documentKey` (the
  // un-namespaced `signPath` minus `/push/`) with the redeemer key. `authorPubkey`
  // must be the redeemer (= the `X-Starfish-Pub` presenter), so the server's
  // author==presenter check passes. Must be in the body BEFORE the request is
  // signed, since `redeemPublicLink` signs the whole body.
  const documentKey = opts.signPath.replace(/^\/push\//, '');
  const author = signAppendAuthor(documentKey, element, opts.redeemer.edPubHex, opts.redeemer.edPrivHex);

  // Exact `StarfishClient.append` body: `{ data }` plus the author proof.
  const body = JSON.stringify({ data: element, ...author });

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

/** One element of an append-only stream log: server-assigned `ts` + the stored
 *  payload (the typed envelope the writer appended). */
export interface StreamElement {
  ts: number;
  data: Record<string, unknown>;
}

/**
 * Read the bot's OWN stream log (the same room it appends to), authorized by the
 * same audience token — the bot's invite cap grants `read`+`list` on this one room,
 * so no extra credential is needed. Used by the smart loop guard to inspect WHO
 * authored the new posts. `sinceTs` (the append-pull `?checkpoint=`) returns only
 * elements appended after that server timestamp; `last` caps to the newest K.
 *
 * Returns the `{ts,data}` elements; mirrors `StarfishClient.pull(path,{appendField:'items'})`,
 * which extracts `data.items` from the response.
 */
export async function pullOwnStream(
  opts: AppendOptions,
  query: { sinceTs?: number; last?: number } = {},
): Promise<StreamElement[]> {
  const pullSignPath = opts.signPath.replace('/push/', '/pull/');
  const params = new URLSearchParams();
  if (query.sinceTs) params.set('checkpoint', String(query.sinceTs));
  if (query.last) params.set('last', String(query.last));
  const qs = params.toString();
  const actionPath = actionPathFor(opts, pullSignPath) + (qs ? `?${qs}` : '');
  const url = `${opts.serverUrl.replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(opts.serverUrl).host;

  const parsed = parsePublicLink(opts.botToken);
  const redeemHeaders = await redeemPublicLink(parsed, {
    redeemerEdPrivHex: opts.redeemer.edPrivHex,
    redeemerEdPubHex: opts.redeemer.edPubHex,
    method: 'GET',
    pathAndQuery: actionPath, // a GET signs an empty body
    host,
  });

  const res = await fetch(url, { headers: { Accept: 'application/json', ...redeemHeaders } });
  if (!res.ok) {
    throw new Error(`stream pull failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { data?: { items?: StreamElement[] } };
  return body.data?.items ?? [];
}
