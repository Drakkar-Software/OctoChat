/**
 * OctoChat stream-webhook bot — a standalone Node script that uses Starfish
 * `/events` as a webhook-style trigger and, on each room change, appends a line to
 * a PUBLIC stream room as a bot. End-to-end it shows the two halves a real
 * integration needs:
 *
 *     /events (SSE)  ──trigger──▶  handler  ──append──▶  pubstream room
 *      (member cap)                              (audience-cap bot token)
 *
 * Why two credentials? `/events` rejects audience caps, so listening needs a member
 * cap (a read-only public-space invite link); appending to a stream is purpose-built
 * for an audience cap (the "Connect a bot" token). See subscribe.ts / append.ts.
 *
 * Run: copy `.env.example` to `.env`, fill the four values from the app, `pnpm start`.
 */
import { join } from 'node:path';

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { subscribeRoomChanges, type RoomChange } from './subscribe.js';
import { appendToStream, type Redeemer } from './append.js';

// ── Config ────────────────────────────────────────────────────────────────────
// Load this example's own `.env` (Node ≥20.12), resolved next to the example so it
// works whether you launch from the example dir or from the repo root. Falls back
// to the real environment when there's no `.env`.
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'));
} catch {
  /* no .env file — rely on exported env vars */
}

interface BotConfig {
  serverUrl: string;
  namespace: string; // bare name, or '' for the root-mounted local dev server
  inviteLink: string; // read-only public-space invite (listen)
  botToken: string; // stream-bot audience-cap token (post)
  botSignPath: string; // panel "Path to sign"
  watchRoom: string; // optional source-room filter ('' = all)
}

/** Read + validate config. Called from `main`, so a missing var surfaces as a
 *  clean `[bot] fatal: …` line rather than an uncaught module-eval throw. */
function loadConfig(): BotConfig {
  const required = (name: string): string => {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return v;
  };
  return {
    serverUrl: process.env.STARFISH_URL?.trim() || 'http://localhost:8787',
    namespace: process.env.STARFISH_NAMESPACE?.trim() || '',
    inviteLink: required('OCTOCHAT_INVITE_LINK'),
    botToken: required('OCTOCHAT_BOT_TOKEN'),
    botSignPath: required('OCTOCHAT_BOT_SIGN_PATH'),
    watchRoom: process.env.WATCH_ROOM?.trim() || '',
  };
}

// ── Invite-link decode (mirrors apps/mobile/src/lib/starfish/pubspace.ts) ───────
interface PublicInviteToken {
  ownerId: string;
  spaceId: string;
  spaceName?: string;
  cap: unknown; // the owner-signed member cap-cert
  key: string; // the ephemeral subject's Ed25519 private key (hex)
}

function decodeInvite(link: string): PublicInviteToken {
  const bad = 'OCTOCHAT_INVITE_LINK is malformed — paste a public-space invite link (the `…/join#…` URL).';
  let tok: Partial<PublicInviteToken>;
  try {
    const frag = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link;
    const b64 = frag.replace(/-/g, '+').replace(/_/g, '/');
    tok = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as Partial<PublicInviteToken>;
  } catch {
    throw new Error(bad);
  }
  if (!tok?.ownerId || !tok.spaceId || !tok.cap || !tok.key) throw new Error(bad);
  return tok as PublicInviteToken;
}

// ── Identity helpers ────────────────────────────────────────────────────────────
/** The bot's in-app author id: SHA-256(edPub) first 32 hex, mirroring the SDK's
 *  userId derivation so the stream renders a stable author for the bot's posts. */
async function userIdFromEdPub(edPubHex: string): Promise<string> {
  const bytes = Uint8Array.from(edPubHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ── Webhook handler ─────────────────────────────────────────────────────────────
/**
 * Called once per room-change trigger. THIS is where a real integration does its
 * work: pull the changed room (the member cap can read public channels), call an
 * external API, transform, etc. `/events` carries no message content — only that
 * room X changed — so the default below just posts an activity line. Swap the body
 * of `onTrigger` for your logic; keep the `append` call to post back to the stream.
 */
function makeHandler(cfg: BotConfig, redeemer: Redeemer, botAuthorId: string) {
  return async function onTrigger(change: RoomChange): Promise<void> {
    const when = change.ts ? new Date(change.ts).toISOString() : new Date().toISOString();
    const hash = change.hash ? ` (doc ${change.hash.slice(0, 8)}…)` : '';
    const text = `🔔 activity in ${change.roomId}${hash} at ${when}`;
    // The OctoChat chat UI reads a typed envelope; a message is `{ t:'msg', e: StoredMsg }`.
    const element = {
      t: 'msg',
      e: { id: globalThis.crypto.randomUUID(), authorId: botAuthorId, ts: Date.now(), text },
    };
    await appendToStream(
      { serverUrl: cfg.serverUrl, namespace: cfg.namespace, botToken: cfg.botToken, signPath: cfg.botSignPath, redeemer },
      element,
    );
    console.log(`[bot] appended → ${text}`);
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const cfg = loadConfig();
  const invite = decodeInvite(cfg.inviteLink);

  // The bot's own keypair — redeems the audience-cap token. Fresh per run is fine:
  // the "Connect a bot" panel mints with no `allowedIdentities`, so any key may
  // redeem. To PIN the bot, the owner mints a credential allow-listing this edPub
  // (logged below) instead.
  const keys = generateDeviceKeys();
  const redeemer: Redeemer = { edPubHex: keys.edPub, edPrivHex: keys.edPriv };
  const botAuthorId = await userIdFromEdPub(keys.edPub);

  // The bot's own stream room is the last segment of its sign path. We must NEVER
  // react to a change in it: our append re-emits `octochat.chat.changed.<spaceId>`,
  // which would re-trigger us → an infinite loop. (Watching a `pubspace` channel and
  // posting to a `pubstream` room in the SAME space both publish that one topic, so
  // the only reliable guard is skip-self by roomId — not by space.)
  // (URL-parse so a trailing query string on the sign path can't smuggle into the
  // roomId and silently defeat the guard.)
  const targetRoom = new URL(cfg.botSignPath, 'http://_').pathname.split('/').filter(Boolean).pop() ?? '';

  console.log('[bot] OctoChat stream-webhook bot');
  console.log(`[bot] server     ${cfg.serverUrl}${cfg.namespace ? `  (namespace ${cfg.namespace})` : '  (local, no namespace)'}`);
  console.log(`[bot] space      ${invite.spaceId}${invite.spaceName ? `  "${invite.spaceName}"` : ''}`);
  console.log(`[bot] posts to   ${targetRoom}`);
  console.log(`[bot] watching   ${cfg.watchRoom || 'all rooms in the space'}`);
  console.log(`[bot] identity   ${keys.edPub}  (allow-list this edPub to pin the bot)`);

  const handler = makeHandler(cfg, redeemer, botAuthorId);

  const unsubscribe = subscribeRoomChanges({
    serverUrl: cfg.serverUrl,
    namespace: cfg.namespace,
    spaces: [invite.spaceId],
    cap: invite.cap,
    signingKeyHex: invite.key,
    onStatus: (up) => console.log(up ? '[bot] /events connected — waiting for changes…' : '[bot] /events reconnecting…'),
    onChange: (change) => {
      if (change.roomId === targetRoom) return; // skip-self (loop guard)
      if (cfg.watchRoom && change.roomId !== cfg.watchRoom) return; // optional source filter
      void handler(change).catch((e) => console.error('[bot] handler error:', (e as Error).message));
    },
  });

  process.on('SIGINT', () => {
    console.log('\n[bot] shutting down…');
    unsubscribe();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('[bot] fatal:', (e as Error).message);
  process.exit(1);
});
