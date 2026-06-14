/**
 * OctoChat stream-webhook bot — a standalone Node script that uses Starfish
 * `/events` as a webhook-style trigger and, on each room change, appends a line to
 * a PUBLIC stream room as a bot. End-to-end it shows the two halves a real
 * integration needs:
 *
 *     /events (SSE)  ──trigger──▶  handler  ──append──▶  streampub room (access:'public')
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
import { resolveLlmConfig, createLlmReplier, buildHistory, scopeToThread, type LlmConfig } from './llm.js';
import { writeBotProfile } from './profile.js';

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
  llm: LlmConfig | null; // OpenAI/NIM settings, or null = plain "echo" mode
  botName: string; // optional display name to publish as the bot's profile ('' = none)
}

// ── Optional LLM env vars (set LLM_API_KEY to turn the bot into a chat assistant) ──
//   LLM_PROVIDER       openai (default) | nvidia — picks the default baseURL + model
//   LLM_API_KEY        your provider key (REQUIRED to enable LLM mode; unset = echo)
//   LLM_BASE_URL       override the baseURL (e.g. a self-hosted NIM: http://host:8000/v1)
//   LLM_MODEL          override the model (e.g. gpt-4o-mini, meta/llama-3.1-8b-instruct)
//   LLM_SYSTEM_PROMPT  override the assistant's persona/instructions
//   LLM_TEMPERATURE    sampling temperature (default 0.7)
//   LLM_MAX_TOKENS     max reply length (default 512)
//   LLM_HISTORY        how many recent turns to feed as context (default 16)
//   LLM_TIMEOUT_MS     per-call timeout (default 60000); bounds a hung/slow endpoint
//                      so it can't wedge the bot's serialized event chain
// LLM mode reads message TEXT from the target stream room, so it requires
// LOOP_GUARD=skip-author (skip-room ignores that room → fatal at startup).
//
// ── Optional display name ───────────────────────────────────────────────────────
//   BOT_NAME           publish this as the bot's profile pseudo so the app shows a
//                      friendly name instead of the hex author-id prefix (see profile.ts).

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
  const llm = resolveLlmConfig();
  // Fail fast rather than silently flipping the guard the user is actively tuning:
  // the LLM answers by reading the target room's text, which skip-room never pulls.
  if (llm && guard === 'skip-room') {
    throw new Error(
      'LLM mode reads message text from the target stream room, which LOOP_GUARD=skip-room ignores. ' +
        'Set LOOP_GUARD=skip-author and restart.',
    );
  }
  return {
    serverUrl: process.env.STARFISH_URL?.trim() || 'http://localhost:8787',
    namespace: process.env.STARFISH_NAMESPACE?.trim() || '',
    inviteLink: required('OCTOCHAT_INVITE_LINK'),
    botToken: required('OCTOCHAT_BOT_TOKEN'),
    botSignPath: required('OCTOCHAT_BOT_SIGN_PATH'),
    watchRoom: process.env.WATCH_ROOM?.trim() || '',
    loopGuard: guard,
    llm,
    botName: process.env.BOT_NAME?.trim() || '',
  };
}

// ── Invite-link decode (mirrors createSpaceInviteLink / encodeSpaceInviteLink) ───
interface SpaceInviteToken {
  v?: number;
  spaceId: string;
  spaceName?: string;
  cap: unknown; // the owner-signed member cap-cert
  key: string; // the ephemeral subject's Ed25519 private key (hex)
  write?: boolean;
}

function decodeInvite(link: string): SpaceInviteToken {
  const bad = 'OCTOCHAT_INVITE_LINK is malformed — paste a space invite link (the `…/join#…` URL).';
  let tok: Partial<SpaceInviteToken>;
  try {
    const frag = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link;
    const b64 = frag.replace(/-/g, '+').replace(/_/g, '/');
    tok = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as Partial<SpaceInviteToken>;
  } catch {
    throw new Error(bad);
  }
  if (!tok?.spaceId || !tok.cap || !tok.key) throw new Error(bad);
  return tok as SpaceInviteToken;
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

/** The fields the loop guard + thread routing read off a stream message's payload (the
 *  `e` inside a `{ t:'msg', e }` envelope): its `id` (dedupe), self-declared `authorId`
 *  (loop guard) and `parentId` — the thread it belongs to, if any. */
interface TriggerMsg {
  id: string;
  authorId?: string;
  parentId?: string;
}

/** A reply strategy turns a trigger — and, for the bot's own room, the pulled stream
 *  log — into the text to post, or `null` to stay silent. `echo` ignores content and
 *  posts an activity line; `llm` reads the log and answers it (both built in `main`).
 *  The optional `trigger` is the newest foreign message that prompted the reply; its
 *  `parentId` is what routes the answer into the right thread. */
type ReplyStrategy = (change: RoomChange, items?: StreamElement[], trigger?: TriggerMsg) => Promise<string | null>;

/**
 * Wrap a reply strategy with the append + circuit-breaker plumbing. Called once per
 * trigger: if the strategy returns text, it's appended to the stream as a bot
 * message. The breaker counts only ACTUAL appends, so a strategy that declines —
 * e.g. an LLM error or rate-limit returns `null` — can never trip it; only a genuine
 * append loop can. Swap the strategy (in `main`) for your own logic; this plumbing
 * and the `append` call back to the stream stay the same.
 */
function makeHandler(appendOpts: AppendOptions, botAuthorId: string, reply: ReplyStrategy) {
  const recent: number[] = [];
  let tripped = false;
  return async function onTrigger(change: RoomChange, items?: StreamElement[], trigger?: TriggerMsg): Promise<void> {
    if (tripped) return;
    const text = await reply(change, items, trigger);
    if (!text) return; // strategy declined (no content to answer, or LLM error)

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

    // The OctoChat chat UI reads a typed envelope; a message is `{ t:'msg', e: StoredMsg }`.
    // Answer in the SAME thread the trigger was posted in: echo its `parentId` (the
    // thread's anchor id) so the reply lands in that thread. A top-level trigger has no
    // `parentId`, so the reply stays top-level — "answer in a thread iff the question was".
    const e: { id: string; authorId: string; ts: number; text: string; parentId?: string } = {
      id: globalThis.crypto.randomUUID(),
      authorId: botAuthorId,
      ts: Date.now(),
      text,
    };
    if (trigger?.parentId) e.parentId = trigger.parentId;
    const element = { t: 'msg', e };
    await appendToStream(appendOpts, element);
    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
    console.log(`[bot] appended → ${preview}`);
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

  // Two reply strategies. `echo` (no LLM configured) posts a plain activity line.
  // `llm` answers the room: it only fires where the bot can READ content — its own
  // stream room, whose log `checkTargetRoom` pulls and hands in as `items` — so for
  // any other room (no `items`) it returns null and the bot stays silent.
  const llm = cfg.llm ? createLlmReplier(cfg.llm) : null;
  const echoReply: ReplyStrategy = async (change) => {
    const when = change.ts ? new Date(change.ts).toISOString() : new Date().toISOString();
    const hash = change.hash ? ` (doc ${change.hash.slice(0, 8)}…)` : '';
    return `🔔 activity in ${change.roomId}${hash} at ${when}`;
  };
  const llmReply: ReplyStrategy = async (_change, items, trigger) => {
    if (!items?.length) return null; // no readable content (not the bot's own room)
    // Answer with the context of the conversation the question was in: a thread reply
    // (trigger.parentId set) sees that thread's messages; a top-level question sees the
    // channel's top-level posts. The bot's own reply is routed to match (see makeHandler).
    const scoped = scopeToThread(items, trigger?.parentId ?? null);
    const history = buildHistory(scoped, botAuthorId, {
      systemPrompt: cfg.llm!.systemPrompt,
      maxTurns: cfg.llm!.historyTurns,
    });
    if (history.length <= 1) return null; // system prompt only → nothing to answer
    return llm!(history);
  };
  const handler = makeHandler(appendOpts, botAuthorId, cfg.llm ? llmReply : echoReply);

  // skip-author state. We dedupe by message id with a `seen` set SEEDED at startup:
  // every post that already exists is baselined as seen (reacted to: none), then the
  // bot reacts only to NEW ids that aren't its own. This converges regardless of how
  // the server treats `?checkpoint=` (we pull the full log, like the app's stream hook
  // does) and is robust to the bot's per-run identity — its OWN 🔔 appends get
  // ingested + recognised by authorId, so they never re-trigger it. Target-room checks
  // run through a promise chain so `seen` mutates consistently under overlapping events.
  const seen = new Set<string>();
  let chain = Promise.resolve();
  /** Record new message ids; return the NEWEST newly-seen post authored by someone other
   *  than the bot — the one to react to — or null if there is none. Items arrive in
   *  append (server-`ts`) order, so the LAST new foreign message seen is the newest.
   *  `react=false` (startup baseline) ingests without ever signalling a reaction. */
  const ingestNewPosts = (items: StreamElement[], react: boolean): TriggerMsg | null => {
    let trigger: TriggerMsg | null = null;
    for (const i of items) {
      const env = i.data as { t?: string; e?: TriggerMsg };
      if (env?.t !== 'msg' || !env.e?.id || seen.has(env.e.id)) continue;
      seen.add(env.e.id);
      if (react && env.e.authorId !== botAuthorId) trigger = env.e; // newest wins (append order)
    }
    return trigger;
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
        const items = await pullOwnStream(appendOpts, {});
        const trigger = ingestNewPosts(items, true);
        if (trigger) {
          const where = trigger.parentId ? `thread ${trigger.parentId.slice(0, 8)}…` : 'the channel';
          console.log(`[bot] new post by someone else in ${where} — reacting`);
          await handler(change, items, trigger); // hand the log + trigger to the strategy
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
  console.log(`[bot] reply mode ${cfg.llm ? `llm — ${cfg.llm.model} via ${cfg.llm.baseUrl}` : 'echo — posts an activity line'}`);
  console.log(`[bot] identity   ${keys.edPub}  (allow-list this edPub to pin the bot)`);

  // Optional display name: publish the bot's profile pseudo so its posts render
  // under a friendly name (not the hex id). Fail-fast — an operator who named the
  // bot shouldn't have it silently fall back to a hex prefix. Fresh keys per run
  // mean a new profile each run; persist the keypair externally for one identity
  // that survives restarts (the example has no built-in stable-key option).
  if (cfg.botName) {
    await writeBotProfile(
      { serverUrl: cfg.serverUrl, namespace: cfg.namespace, edPubHex: keys.edPub, edPrivHex: keys.edPriv, kemPubHex: keys.kemPub, userId: botAuthorId },
      cfg.botName,
    );
    console.log(`[bot] profile    set display name → "${cfg.botName}"`);
  }

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
