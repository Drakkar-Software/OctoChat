/**
 * OctoChat stream PUBLISH — a standalone Node script that publishes ONE message
 * into a PUBLIC stream room as a bot, then exits. No `/events`, no webhook, no
 * waiting: just the "post" half of an integration.
 *
 *     publish  ──append──▶  pubstream room
 *               (audience-cap bot token)
 *
 * A stream room is an append-only log, so posting is a single signed `POST /push`
 * — no pull / merge / hash, no sync protocol. The bot is authorized by the
 * owner-minted "Connect a bot" token, a Starfish `createPublicLink` AUDIENCE cap
 * (no embedded secret): the bot generates its OWN keypair and signs the request
 * with it, naming that key via `X-Starfish-Pub` (`redeemPublicLink`). A leaked
 * token is therefore useless to anyone who can't also sign, and writes stay
 * attributable per bot.
 *
 * We reproduce `StarfishClient.append`'s exact wire format
 * (`body = JSON.stringify({ data })`, `Content-Type: application/json`) so the
 * server accepts it identically. The Python sibling (`../python/publish.py`) is a
 * line-for-line mirror.
 *
 * Run: copy `../.env.example` to `../.env`, fill OCTOCHAT_BOT_TOKEN +
 * OCTOCHAT_BOT_SIGN_PATH (and optionally MESSAGE) from the app, then `pnpm start`.
 */
import { join } from 'node:path';

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { parsePublicLink, redeemPublicLink } from '@drakkar.software/starfish-sharing';

// Load the example's shared `.env` (Node ≥20.12), resolved at the example root
// (two levels up from this file) so it works whether you launch from `ts/` or the
// repo root. Falls back to the real environment when there's no `.env`.
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  /* no .env file — rely on exported env vars */
}

interface Config {
  serverUrl: string; // sync base URL (may include a mount path, e.g. `https://host/sync`)
  namespace: string; // bare name, or '' for the root-mounted local dev server
  botToken: string; // stream-bot audience-cap token ("Bot link token")
  signPath: string; // panel "Path to sign", un-namespaced
  message: string; // the text to publish
}

/** Read + validate config. Called from `main`, so a missing var surfaces as a
 *  clean `[publish] fatal: …` line rather than an uncaught module-eval throw. */
function loadConfig(): Config {
  const required = (name: string): string => {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return v;
  };
  return {
    serverUrl: process.env.STARFISH_URL?.trim() || 'http://localhost:8787',
    namespace: process.env.STARFISH_NAMESPACE?.trim() || '',
    botToken: required('OCTOCHAT_BOT_TOKEN'),
    signPath: required('OCTOCHAT_BOT_SIGN_PATH'),
    message: process.env.MESSAGE?.trim() || 'Hello from the OctoChat publish example 🐙',
  };
}

/** The bot's in-app author id: SHA-256(edPub) first 32 hex, mirroring the SDK's
 *  userId derivation so the stream renders a stable author for the bot's posts. */
async function userIdFromEdPub(edPubHex: string): Promise<string> {
  const bytes = Uint8Array.from(edPubHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function main(): Promise<void> {
  const cfg = loadConfig();

  // The bot's own keypair redeems the audience-cap token. Fresh per run is fine:
  // the "Connect a bot" panel mints with no `allowedIdentities`, so any key may
  // redeem. To PIN the bot, mint a credential allow-listing this edPub (logged below).
  const keys = generateDeviceKeys();
  const authorId = await userIdFromEdPub(keys.edPub);

  // The path the SERVER observes: namespace prefix + the panel's action path. We
  // sign THIS exact string and POST it under serverUrl (whose mount, e.g. `/sync`,
  // nginx strips before the server sees the signed path) — matching how
  // StarfishClient signs `applyNamespace(path)` while POSTing `baseUrl + that`.
  const actionPath = (cfg.namespace ? `/v1/${cfg.namespace}` : '') + cfg.signPath;
  const url = `${cfg.serverUrl.replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(cfg.serverUrl).host;

  // The OctoChat chat UI reads a typed envelope; a message is `{ t:'msg', e: StoredMsg }`.
  // The server stamps each appended element with an authoritative `{ ts }`, so the
  // `ts` we send is only a client hint (omit it to avoid any monotonic 409).
  const element = {
    t: 'msg',
    e: { id: globalThis.crypto.randomUUID(), authorId, ts: Date.now(), text: cfg.message },
  };

  // Exact `StarfishClient.append` body: the element wrapped as `{ data }`. Bind it
  // ONCE so the signed bytes equal the bytes sent on the wire.
  const body = JSON.stringify({ data: element });

  const redeemHeaders = await redeemPublicLink(parsePublicLink(cfg.botToken), {
    redeemerEdPrivHex: keys.edPriv,
    redeemerEdPubHex: keys.edPub,
    method: 'POST',
    pathAndQuery: actionPath,
    body, // signed bytes MUST equal the bytes sent on the wire
    host,
  });

  console.log('[publish] OctoChat stream publish');
  console.log(`[publish] server   ${cfg.serverUrl}${cfg.namespace ? `  (namespace ${cfg.namespace})` : '  (local, no namespace)'}`);
  console.log(`[publish] identity ${keys.edPub}  (allow-list this edPub to pin the bot)`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...redeemHeaders },
    body,
  });
  if (!res.ok) {
    throw new Error(`append failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  console.log(`[publish] appended → ${cfg.message}`);
}

main().catch((e) => {
  console.error('[publish] fatal:', (e as Error).message);
  process.exit(1);
});
