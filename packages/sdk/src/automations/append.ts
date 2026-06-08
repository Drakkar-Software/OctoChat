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

/** Namespace-prefixed action path the SERVER observes after nginx strips the
 *  mount. The bot's stored `signPath` is the un-namespaced action (`/push/…`);
 *  we prepend `/v1/<ns>` here, matching how `StarfishClient` signs it. */
function actionPathFor(signPath: string): string {
  return (getSyncNamespace() ? `/v1/${getSyncNamespace()}` : '') + signPath;
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
  const actionPath = actionPathFor(opts.signPath);
  const url = `${getSyncBase().replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(getSyncBase()).host;

  // Author proof bound to the storage documentKey (`signPath` minus `/push/`).
  // Required by `requireAuthorSignature` (server default since Starfish alpha.8).
  // The author key MUST equal the X-Starfish-Pub presenter so the server's
  // author==presenter check passes.
  const documentKey = opts.signPath.replace(/^\/push\//, '');
  const author = signAppendAuthor(documentKey, opts.element, opts.redeemer.edPubHex, opts.redeemer.edPrivHex);

  const body = JSON.stringify({ data: opts.element, ...author });

  const parsed = parsePublicLink(opts.botToken);
  const redeemHeaders = await redeemPublicLink(parsed, {
    redeemerEdPrivHex: opts.redeemer.edPrivHex,
    redeemerEdPubHex: opts.redeemer.edPubHex,
    method: 'POST',
    pathAndQuery: actionPath,
    body,
    host,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...redeemHeaders },
    body,
  });
  if (!res.ok) {
    throw new Error(`bot append failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}
