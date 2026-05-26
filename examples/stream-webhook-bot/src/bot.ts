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
import { appendToStream, pullOwnStream, type AppendOptions, type Redeemer, type StreamElement } from './append.js';

/** Loop-guard strategy — how the bot avoids reacting to its own appends:
 *  - `skip-room`  : never react to ANY change in its own target room. Stateless,
 *                   unloopable, but can't react to others' posts in that room.
 *  - `skip-author`: on a target-room change, pull the new posts and react only to
 *                   those NOT authored by the bot — so it can watch AND post in the
 *                   same room. Needs a checkpoint + one pull per change. NOTE the
 *                   author is the self-declared `e.authorId`, a trust assumption, not
 *                   cryptographic proof (see README → "authorship proof"). */
type LoopGuard = 'skip-room' | 'skip-author';

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
  loopGuard: LoopGuard; // how to avoid reacting to the bot's own posts
}

/** Read + validate config. Called from `main`, so a missing var surfaces as a
 *  clean `[bot] fatal: …` line rather than an uncaught module-eval throw. */
function loadConfig(): BotConfig {
  const required = (name: string): string => {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return v;
  };
  const guard = (process.env.LOOP_GUARD?.trim() || 'skip-room') as LoopGuard;
  if (guard !== 'skip-room' && guard !== 'skip-author') {
    throw new Error(`LOOP_GUARD must be "skip-room" or "skip-author", got "${guard}"`);
  }
  return {
    serverUrl: process.env.STARFISH_URL?.trim() || 'http://localhost:8787',
    namespace: process.env.STARFISH_NAMESPACE?.trim() || '',
    inviteLink: required('OCTOCHAT_INVITE_LINK'),
    botToken: required('OCTOCHAT_BOT_TOKEN'),
    botSignPath: required('OCTOCHAT_BOT_SIGN_PATH'),
    watchRoom: process.env.WATCH_ROOM?.trim() || '',
    loopGuard: guard,
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
/** Circuit-breaker: if the bot ever appends more than this many times within the
 *  window, it LATCHES OFF and refuses further appends. A correct loop guard never
 *  trips this; it's a backstop so a guard bug can't flood the stream (as an earlier
 *  version did) — breaking the loop by simply not appending. */
const MAX_APPENDS = 8;
const APPEND_WINDOW_MS = 10_000;

/**
 * Called once per room-change trigger. THIS is where a real integration does its
 * work: pull the changed room (the member cap can read public channels), call an
 * external API, transform, etc. `/events` carries no message content — only that
 * room X changed — so the default below just posts an activity line. Swap the body
 * of `onTrigger` for your logic; keep the `append` call to post back to the stream.
 */
function makeHandler(appendOpts: AppendOptions, botAuthorId: string) {
  const recent: number[] = [];
  let tripped = false;
  return async function onTrigger(change: RoomChange): Promise<void> {
    if (tripped) return;
    const now = Date.now();
    while (recent.length && now - recent[0]! > APPEND_WINDOW_MS) recent.shift();
    if (recent.length >= MAX_APPENDS) {
      tripped = true;
      console.error(
        `[bot] circuit breaker: ${MAX_APPENDS} appends within ${APPEND_WINDOW_MS / 1000}s — likely a loop. ` +
          `Refusing further appends (restart to resume).`,
      );
      return;
    }
    recent.push(now);

    const when = change.ts ? new Date(change.ts).toISOString() : new Date().toISOString();
    const hash = change.hash ? ` (doc ${change.hash.slice(0, 8)}…)` : '';
    const text = `🔔 activity in ${change.roomId}${hash} at ${when}`;
    // The OctoChat chat UI reads a typed envelope; a message is `{ t:'msg', e: StoredMsg }`.
    const element = {
      t: 'msg',
      e: { id: globalThis.crypto.randomUUID(), authorId: botAuthorId, ts: Date.now(), text },
    };
    await appendToStream(appendOpts, element);
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
  const appendOpts: AppendOptions = {
    serverUrl: cfg.serverUrl,
    namespace: cfg.namespace,
    botToken: cfg.botToken,
    signPath: cfg.botSignPath,
    redeemer,
  };

  // The bot's own stream room (the last segment of its sign path). Posting here
  // re-emits `octochat.chat.changed.<spaceId>`, so reacting to changes in it risks an
  // infinite loop — how that's avoided depends on the loop-guard mode (below).
  // (URL-parse so a trailing query string on the sign path can't smuggle into the
  // roomId and silently defeat the guard.)
  const targetRoom = new URL(cfg.botSignPath, 'http://_').pathname.split('/').filter(Boolean).pop() ?? '';

  const handler = makeHandler(appendOpts, botAuthorId);

  // skip-author state. We dedupe by message id with a `seen` set SEEDED at startup:
  // every post that already exists is baselined as seen (reacted to: none), then the
  // bot reacts only to NEW ids that aren't its own. This converges regardless of how
  // the server treats `?checkpoint=` (we pull the full log, like the app's stream hook
  // does) and is robust to the bot's per-run identity — its OWN 🔔 appends get
  // ingested + recognised by authorId, so they never re-trigger it. Target-room checks
  // run through a promise chain so `seen` mutates consistently under overlapping events.
  const seen = new Set<string>();
  let chain = Promise.resolve();
  /** Record new message ids; return true if any NEWLY-seen post is by someone else.
   *  `react=false` (startup baseline) ingests without ever signalling a reaction. */
  const ingestNewPosts = (items: StreamElement[], react: boolean): boolean => {
    let foreign = false;
    for (const i of items) {
      const env = i.data as { t?: string; e?: { id?: string; authorId?: string } };
      if (env?.t !== 'msg' || !env.e?.id || seen.has(env.e.id)) continue;
      seen.add(env.e.id);
      if (react && env.e.authorId !== botAuthorId) foreign = true;
    }
    return foreign;
  };
  if (cfg.loopGuard === 'skip-author') {
    ingestNewPosts(await pullOwnStream(appendOpts, {}).catch(() => []), false); // baseline existing posts
  }

  // Target-room handler for skip-author: pull the log, ingest new ids, and react ONCE
  // if any new post is by someone other than the bot. The bot's own 🔔 appends are
  // ingested too (seen + recognised by authorId) so they never re-trigger it → no loop.
  const checkTargetRoom = (change: RoomChange) => {
    chain = chain
      .then(async () => {
        if (ingestNewPosts(await pullOwnStream(appendOpts, {}), true)) {
          console.log('[bot] new post by someone else in target room — reacting');
          await handler(change);
        }
      })
      .catch((e) => console.error('[bot] author-check error:', (e as Error).message));
  };

  console.log('[bot] OctoChat stream-webhook bot');
  console.log(`[bot] server     ${cfg.serverUrl}${cfg.namespace ? `  (namespace ${cfg.namespace})` : '  (local, no namespace)'}`);
  console.log(`[bot] space      ${invite.spaceId}${invite.spaceName ? `  "${invite.spaceName}"` : ''}`);
  console.log(`[bot] posts to   ${targetRoom}`);
  console.log(`[bot] watching   ${cfg.watchRoom || 'all rooms in the space'}`);
  console.log(`[bot] loop guard ${cfg.loopGuard}${cfg.loopGuard === 'skip-author' ? '  (reacts to others’ posts in the target room too)' : '  (ignores the target room entirely)'}`);
  console.log(`[bot] identity   ${keys.edPub}  (allow-list this edPub to pin the bot)`);

  const unsubscribe = subscribeRoomChanges({
    serverUrl: cfg.serverUrl,
    namespace: cfg.namespace,
    spaces: [invite.spaceId],
    cap: invite.cap,
    signingKeyHex: invite.key,
    onStatus: (up) => console.log(up ? '[bot] /events connected — waiting for changes…' : '[bot] /events reconnecting…'),
    onChange: (change) => {
      if (cfg.watchRoom && change.roomId !== cfg.watchRoom) return; // optional source filter
      if (change.roomId === targetRoom) {
        // The bot's own stream room. skip-room: ignore it (stateless, unloopable).
        // skip-author: pull + react only to posts that aren't the bot's own.
        if (cfg.loopGuard === 'skip-author') checkTargetRoom(change);
        return;
      }
      // Any other room: the bot doesn't post here, so there's no loop — react directly.
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
