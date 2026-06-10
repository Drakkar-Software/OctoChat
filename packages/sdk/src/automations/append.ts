/**
 * The "post as a bot" half: append one element to a PUBLIC stream room via the
 * bot's `createPublicLink` audience cap. Mirrors `examples/stream-webhook-bot/src/append.ts`
 * exactly so the wire format matches the server's expectation: same `{ data }`
 * body shape, same `signAppendAuthor` author-proof, same `redeemPublicLink`
 * headers, same `X-Starfish-Pub`-signed POST. The runner can't drive this through
 * `StarfishClient.append` (which only knows member-cap auth), so we POST by hand.
 */
import { parsePublicLink, redeemPublicLink } from '@drakkar.software/starfish-sharing';
import { signAppendAuthor } from '@drakkar.software/starfish-protocol';

import { getSyncBase, getSyncNamespace } from '../config/config';

/** A fresh Ed25519 keypair the bot redeems the audience cap with. Distinct from
 *  the user's identity key — by design, a leaked link is useless without it. */
export interface BotRedeemer {
  edPubHex: string;
  edPrivHex: string;
}

/** A non-2xx response to {@link appendAsBot}, carrying the HTTP status so a caller
 *  can branch on it (e.g. dm-link.ts maps a 401/403 — rotated/disabled/expired
 *  audience cap — onto its own typed error). Message unchanged from the bare
 *  `Error` this used to throw, so existing string-matching callers keep working. */
export class AppendHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppendHttpError';
  }
}

/** Namespace-prefixed action path the SERVER observes after nginx strips the
 *  mount. The bot's stored `signPath` is the un-namespaced action (`/push/…`);
 *  we prepend `/v1/<ns>` here, matching how `StarfishClient` signs it. */
function actionPathFor(signPath: string): string {
  return (getSyncNamespace() ? `/v1/${getSyncNamespace()}` : '') + signPath;
}

/**
 * POST one append to a stream/inbox by hand, signed with the writer's own key —
 * the shared core of {@link appendAsBot} (audience-cap redeem) and the anonymous
 * DM-link delivery (`dm-link.ts`). `StarfishClient.append` only knows member-cap
 * auth, so both go through here. Builds the namespaced URL + the
 * `{ data, …authorProof }` body (the wire shape the server's append handler
 * expects), signs the append AUTHOR proof with `author` (required by
 * `requireAuthorSignature`, default on), lets the caller attach any AUTH headers
 * derived from the exact bytes/URL sent (none for an anonymous public write; the
 * redeem set for an audience cap), and maps a non-2xx to {@link AppendHttpError}.
 */
export async function postSignedAppend(opts: {
  signPath: string;
  element: Record<string, unknown>;
  /** Signs the append author proof; must equal the request presenter when one exists. */
  author: BotRedeemer;
  /** Auth headers from the on-the-wire request (e.g. `redeemPublicLink`); omit for anonymous. */
  authHeaders?: (ctx: { actionPath: string; host: string; body: string }) => Promise<Record<string, string>>;
  failurePrefix?: string;
}): Promise<void> {
  const actionPath = actionPathFor(opts.signPath);
  const url = `${getSyncBase().replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(getSyncBase()).host;
  // Author proof bound to the storage documentKey (`signPath` minus `/push/`).
  const documentKey = opts.signPath.replace(/^\/push\//, '');
  const author = signAppendAuthor(documentKey, opts.element, opts.author.edPubHex, opts.author.edPrivHex);
  const body = JSON.stringify({ data: opts.element, ...author });
  const authHeaders = opts.authHeaders ? await opts.authHeaders({ actionPath, host, body }) : {};
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders },
    body,
  });
  if (!res.ok) {
    throw new AppendHttpError(res.status, `${opts.failurePrefix ?? 'append'} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

/** Append one envelope to the bot's stream. `element` is the same typed envelope
 *  the chat UI renders — for a posted message that's `{ t: 'msg', e: { id, authorId, ts, text } }`.
 *  Server stamps `ts` so we omit it (avoids monotonic-timestamp 409 on concurrent appends). */
export async function appendAsBot(opts: {
  botToken: string;
  signPath: string;
  redeemer: BotRedeemer;
  element: Record<string, unknown>;
}): Promise<void> {
  const parsed = parsePublicLink(opts.botToken);
  await postSignedAppend({
    signPath: opts.signPath,
    element: opts.element,
    // The author key MUST equal the X-Starfish-Pub presenter so the server's
    // author==presenter check passes — same key signs the proof and redeems.
    author: opts.redeemer,
    authHeaders: async ({ actionPath, host, body }) => ({
      ...(await redeemPublicLink(parsed, {
        redeemerEdPrivHex: opts.redeemer.edPrivHex,
        redeemerEdPubHex: opts.redeemer.edPubHex,
        method: 'POST',
        pathAndQuery: actionPath,
        body,
        host,
      })),
    }),
    failurePrefix: 'bot append',
  });
}
