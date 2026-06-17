/**
 * OctoDesk "sealed resource request" — submit a ticket request from a FRESH
 * identity using nothing but the desk bot's public **identity link**. No cap,
 * no REST API, no space invite required from the requester side. The round-trip
 * drives the new `submitResourceRequest` / `scanResourceRequests` /
 * `acceptResourceRequest` / `scanResourceGrants` / `acceptResourceGrant`
 * primitive end-to-end:
 *
 *   REQUESTER (fresh identity; holds only the bot's public identity link)
 *     └── submitResourceRequest(botLink, { spaceId, nodeType:'ticket', … })
 *           └─▶ sealed envelope ──────────────▶ inbox/{botId}/{shard}
 *
 *   BOT (space owner, reconcile loop)
 *     scanResourceRequests
 *       └─▶ acceptResourceRequest({ create: makeTicketCreateHandler() })
 *             ├─▶ createTicketNode(title, meta, reqId)
 *             └─▶ inviteToNode → nodeMemberScope cap
 *                   └─▶ seal ResourceGrant ──▶ inbox/{requesterId}/{shard}
 *
 *   REQUESTER (poll back)
 *     scanResourceGrants → acceptResourceGrant
 *       └─▶ nodeStreamScope cap stored → post a message into the ticket invite stream
 *
 *   BOT (read-back)
 *     getNodeStreamClient → pullAndFold on the ticket invite stream
 *
 * The requester ends up with a **ticket-scoped cap only** — they can read/write
 * that one ticket room; they cannot see other rooms or tickets in the space.
 *
 * Three modes:
 *   PERSISTED (default):  on first run, creates a fresh bot + space and saves
 *     keys + space id + KV snapshot to `.bot-state.json` next to `.env`.
 *     Subsequent runs restore from that file — same identity link every time.
 *   ENV-DRIVEN:  set BOT_IDENTITY_LINK and REQUESTER_SPACE_ID to use a real
 *     desk bot without any local state file.
 *   STATELESS:  set STATELESS=1 to disable persistence (ephemeral identity,
 *     useful for CI / one-shot testing).
 *
 * The state file stores private keys in plaintext — keep it out of source
 * control (it is listed in .gitignore as `.bot-state.json`).
 *
 * Run from the repo root:
 *   pnpm --filter @drakkar.software/octochat-sdk build
 *   STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
 *   STARFISH_URL=http://127.0.0.1:8799 \
 *     node_modules/.bin/tsx examples/create-ticket/ts/src/request.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// The headless OctoChat core — imported by relative path to the built entry.
// Rebuild if stale:  pnpm --filter @drakkar.software/octochat-sdk build
import {
  SpaceAccessError,
  acceptResourceGrant,
  acceptResourceRequest,
  buildSession,
  configureKv,
  configureOctoChat,
  createSpace,
  decodeIdentityLink,
  ensureDeskTicketStreamAccess,
  ensureProfileKeys,
  getNodeStreamClient,
  makeTicketCreateHandler,
  myIdentityLink,
  objInvLogPull,
  objInvLogPush,
  openEncryptor,
  ownerTrustedAdders,
  pullAndFold,
  randomId,
  readPeerKeys,
  scanResourceGrants,
  scanResourceRequests,
  submitResourceRequest,
  userIdFromEdPub,
  type IdentityLink,
  type Session,
  type StoredMsg,
  type StreamEnvelope,
} from '../../../../packages/sdk/dist/index.js';

// Load the example's shared `.env` from the example root (two levels up).
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  /* no .env file — rely on exported env vars */
}

const SERVER = process.env.STARFISH_URL?.trim() || 'http://localhost:8787';
const NAMESPACE = process.env.STARFISH_NAMESPACE?.trim() || undefined;
/** A full `<origin>/request#<token>` identity link for a live desk bot.
 *  When empty the example creates a fresh bot + space automatically. */
const BOT_IDENTITY_LINK = process.env.BOT_IDENTITY_LINK?.trim() || '';
/** The bot's OctoDesk space id — required when BOT_IDENTITY_LINK is set. */
const REQUESTER_SPACE_ID = process.env.REQUESTER_SPACE_ID?.trim() || '';
const BOT_NAME = process.env.BOT_NAME?.trim() || 'Desk Bot';
const REQUESTER_NAME = process.env.REQUESTER_NAME?.trim() || 'Alice (requester)';
const TICKET_ORIGIN = process.env.TICKET_ORIGIN?.trim() || 'https://desk.drakkar.software';
/** Set STATELESS=1 to skip loading/saving the bot state file. */
const STATELESS = process.env.STATELESS === '1';

// ── Local bot-state persistence ───────────────────────────────────────────────

/** Stored in `.bot-state.json` next to `.env` — private keys, gitignored. */
interface BotState {
  userId: string;
  spaceId: string;
  keys: { edPub: string; edPriv: string; kemPub: string; kemPriv: string };
  kv: Record<string, string>;
}

const STATE_FILE = join(import.meta.dirname, '..', '..', '.bot-state.json');

async function loadBotState(): Promise<BotState | null> {
  if (STATELESS) return null;
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as BotState;
  } catch {
    return null; // not found or unreadable — start fresh
  }
}

async function saveBotState(state: BotState): Promise<void> {
  if (STATELESS) return;
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/** How often (ms) to poll for the bot's reconcile / the requester's grant. */
const POLL_MS = 500;
const MAX_ATTEMPTS = 40;
const PROFILE_PUBLISH_TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Create a fresh session and wait until its profile keys are published + readable. */
async function newUser(name: string): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdFromEdPub(keys.edPub);
  const session = await buildSession({ userId, keys }, name);
  await ensureProfileKeys(session.accountClient, userId, keys).catch((e: unknown) => {
    // hash_mismatch = ConflictError: buildSession's fire-and-forget won the race — keys
    // ARE written; just continue to poll.
    if ((e as Error)?.message !== 'hash_mismatch') throw e;
  });
  const pollInterval = 150;
  const maxPolls = Math.ceil(PROFILE_PUBLISH_TIMEOUT_MS / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    if (await readPeerKeys(userId)) return session;
    if (i > 0 && i % 20 === 0)
      console.log(`[req] …waiting for ${name}'s keys (${i * pollInterval}ms / ${PROFILE_PUBLISH_TIMEOUT_MS}ms)`);
    await sleep(pollInterval);
  }
  throw new Error(`profile keys for ${name} not readable after ${PROFILE_PUBLISH_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  configureOctoChat({ syncBase: SERVER, ...(NAMESPACE ? { syncNamespace: NAMESPACE } : {}) });

  // ── KV: write-through adapter persisting to .bot-state.json ──────────────
  // Load any saved state first so the Map is pre-populated before configureKv.
  const saved = await loadBotState();
  const mem = new Map<string, string>(Object.entries(saved?.kv ?? {}));

  // currentBotInfo is set once we know the bot's keys/userId/spaceId.
  // flushState is a no-op until then (guards on null).
  let currentBotInfo: BotState | null = saved
    ? { userId: saved.userId, spaceId: saved.spaceId, keys: saved.keys, kv: {} }
    : null;

  const flushState = async (): Promise<void> => {
    if (!currentBotInfo) return;
    await saveBotState({ ...currentBotInfo, kv: Object.fromEntries(mem) });
  };

  configureKv({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => { mem.set(k, v); await flushState(); },
    remove: async (k) => { mem.delete(k); await flushState(); },
  });

  console.log('[req] OctoDesk sealed resource-request example');
  console.log(`[req] server  ${SERVER}${NAMESPACE ? `  (namespace ${NAMESPACE})` : '  (local)'}`);

  // ── 1. Bot identity + desk space ─────────────────────────────────────────
  let botLink: IdentityLink;
  let bot: Session | undefined;
  let spaceId: string;

  if (BOT_IDENTITY_LINK && REQUESTER_SPACE_ID) {
    // Env-driven: use a real bot link + space id (no local state file involved).
    const i = BOT_IDENTITY_LINK.indexOf('#');
    botLink = decodeIdentityLink(i === -1 ? BOT_IDENTITY_LINK : BOT_IDENTITY_LINK.slice(i + 1));
    spaceId = REQUESTER_SPACE_ID;
    console.log(`[req] bot     via BOT_IDENTITY_LINK (${botLink.ownerId.slice(0, 8)}…)`);
    console.log(`[req] space   via REQUESTER_SPACE_ID → ${spaceId.slice(0, 8)}…`);
  } else if (saved) {
    // Restored: rebuild session from saved keys — no newUser / createSpace needed.
    bot = await buildSession({ userId: saved.userId, keys: saved.keys }, BOT_NAME);
    spaceId = saved.spaceId;
    const fullLink = await myIdentityLink(bot, TICKET_ORIGIN, '/request');
    if (!fullLink) throw new Error('could not derive bot identity link');
    const i = fullLink.indexOf('#');
    botLink = decodeIdentityLink(i === -1 ? fullLink : fullLink.slice(i + 1));
    console.log(`[req] bot     "${BOT_NAME}" (${bot.userId.slice(0, 8)}…)  [restored from state]`);
    console.log(`[req] space   ${spaceId.slice(0, 8)}…  [restored]`);
    console.log(`[req] link    ${fullLink}`);
  } else {
    // Fresh: generate a new bot + space and persist for next run.
    bot = await newUser(BOT_NAME);
    const space = await createSpace(bot, 'Drakkar Support');
    spaceId = space.id;
    // Set currentBotInfo so flushState captures everything written to mem so far.
    currentBotInfo = { userId: bot.userId, spaceId, keys: bot.keys, kv: {} };
    await flushState();
    const fullLink = await myIdentityLink(bot, TICKET_ORIGIN, '/request');
    if (!fullLink) throw new Error('could not derive bot identity link');
    const i = fullLink.indexOf('#');
    botLink = decodeIdentityLink(i === -1 ? fullLink : fullLink.slice(i + 1));
    console.log(`[req] bot     "${BOT_NAME}" (${bot.userId.slice(0, 8)}…)  [new — state saved to ${STATE_FILE}]`);
    console.log(`[req] space   "${space.name}" → ${spaceId.slice(0, 8)}…`);
    console.log(`[req] link    ${fullLink}`);
  }

  // ── 2. Requester: a fresh identity that only holds the bot's public link ──
  const requester = await newUser(REQUESTER_NAME);
  console.log(`[req] requester "${REQUESTER_NAME}" (${requester.userId.slice(0, 8)}…)`);

  // ── 3. Requester submits a sealed ticket request ──────────────────────────
  // `submitResourceRequest` verifies the identity link binding offline and
  // cross-checks against the live profile, seals the request to the bot's KEM
  // key, and appends it anonymously to inbox/{botId}/{shard}.
  // The requester needs zero cap — the inbox is public-write.
  console.log('[req] step 3: requester → submitResourceRequest…');
  const { reqId } = await submitResourceRequest(requester, botLink, {
    spaceId,
    nodeType: 'ticket',
    title: 'Login fails on Safari 17',
    meta: { requester: 'alice@example.com', priority: 'high' },
    message: 'Hi! Safari 17.4 on macOS 14.5 returns 403 on /api/login. Chrome works fine.',
  });
  console.log(`[req] submitted  reqId=${reqId}`);

  // ── 4. Bot reconciles its inbox ───────────────────────────────────────────
  // `scanResourceRequests` trial-unseals each inbox item (bad seals are silently
  // skipped), verifies sender identity, and deduplicates by reqId.
  // `acceptResourceRequest` creates the ticket node (via `makeTicketCreateHandler`
  // which stamps `meta.reqId` for future dedup), invites the requester, and seals
  // the `ResourceGrant` back to inbox/{requesterId}/{shard}.
  let ticketNodeId: string | undefined;

  if (bot) {
    console.log('[req] step 4: bot reconciling inbox…');
    const handler = makeTicketCreateHandler();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const pending = await scanResourceRequests(bot, new Set([spaceId]));
      if (pending.length > 0) {
        console.log(`[req] bot     found ${pending.length} pending request(s)`);
        for (const p of pending) {
          const result = await acceptResourceRequest(bot, p, { create: handler });
          ticketNodeId = result.nodeId;
          console.log(`[req] bot     accepted → ticketId=${ticketNodeId}`);
        }
        break;
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(POLL_MS);
    }
    if (!ticketNodeId) throw new Error('bot: no pending requests found after reconcile polling');
  }

  // ── 5. Requester polls for the grant ─────────────────────────────────────
  // `scanResourceGrants` trial-unseals the requester's inbox items to find
  // `ResourceGrant` payloads. `acceptResourceGrant` delegates to `acceptNodeInvite`
  // which stores both the space-level index cap and the narrow per-node cap.
  console.log('[req] step 5: requester polling for grant…');
  let grantedNodeId: string | undefined;
  let grantedSpaceId: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS * 2; attempt++) {
    const grants = await scanResourceGrants(requester);
    const mine = grants.find((g) => g.reqId === reqId);
    if (mine) {
      const { spaceId: gsId, nodeId: gnId } = await acceptResourceGrant(requester, mine);
      grantedNodeId = gnId;
      grantedSpaceId = gsId;
      console.log(`[req] requester accepted grant → nodeId=${grantedNodeId} spaceId=${grantedSpaceId.slice(0, 8)}…`);
      break;
    }
    if (attempt < MAX_ATTEMPTS * 2 - 1) await sleep(POLL_MS);
  }
  if (!grantedNodeId || !grantedSpaceId) throw new Error('requester: no grant received after polling');

  // ── 6. Requester posts a message into the ticket room ────────────────────
  // After `acceptResourceGrant`, the requester holds a `nodeStreamScope` cap for
  // this specific node's INVITE STREAM (`objinvlog`). This cap is stored by
  // `acceptNodeInvite` (via `saveNodeStreamAccessEntry`) and picked up by
  // `getNodeStreamClient`. An invite-ticket log lives in `objinvlog` — a
  // collection EXCLUDED from both `spaceMemberScope` and `nodeMemberScope` — so
  // the append MUST go through the per-node stream cap + `objInvLogPush`.
  // IMPORTANT: pass the real spaceId explicitly — `streamInvRoomPush(nodeId)` derives
  // the space from the room id via split('-'), which only works for `sp-<hex>-<local>`
  // ids, NOT `ticket-<hex>` ids (no embedded space segment → wrong path → 403).
  // The ticket was created with `enc: false`, so no keyring / encryptor is needed.
  console.log('[req] step 6: requester posting a message…');
  const rClient = getNodeStreamClient(grantedSpaceId, grantedNodeId, requester);
  const msgEnv: StreamEnvelope = {
    t: 'msg',
    e: {
      id: randomId(),
      authorId: requester.userId,
      ts: Date.now(),
      text: 'Hi! Consistently fails on macOS 14.5 + Safari 17.4. Cleared cookies, still 403.',
    },
  };
  await rClient.append(objInvLogPush(grantedSpaceId, grantedNodeId), msgEnv as unknown as Record<string, unknown>);
  console.log('[req] requester sent message into ticket room');

  // ── 7. Bot reads the ticket conversation back ─────────────────────────────
  // `objinvlog` is reachable ONLY by an owner-issued member cap (it does not honour the
  // broad owner device cap), so the desk holds a per-node stream cap established at ticket
  // creation. Re-establish it here: this single-process demo shares ONE in-memory access
  // store between bot and requester, and the requester's `acceptResourceGrant` (step 5)
  // overwrote the bot's `${spaceId}:${ticketId}:stream` entry with its own cap. In a real
  // deployment bot and requester are separate processes, so the creation-time cap survives
  // and this call is a harmless idempotent refresh. enc:false → passthrough for pullAndFold.
  if (bot && ticketNodeId) {
    console.log('[req] step 7: bot reading ticket conversation…');
    await ensureDeskTicketStreamAccess(bot, spaceId, ticketNodeId);
    const bClient = getNodeStreamClient(spaceId, ticketNodeId, bot);
    const passthrough = {
      encrypt: async <T>(d: T) => d as unknown as Record<string, unknown>,
      decrypt: async <T>(d: T) => d,
    } as unknown as Awaited<ReturnType<typeof openEncryptor>>;

    const { data } = await pullAndFold(bClient, passthrough, objInvLogPull(spaceId, ticketNodeId));
    const msgs = [...data.messages].sort((a: StoredMsg, b: StoredMsg) => a.ts - b.ts);
    console.log(`\n[req] ── ticket conversation (${msgs.length} message(s)) ──`);
    for (const m of msgs) {
      const who = bot && m.authorId === bot.userId ? BOT_NAME : `${REQUESTER_NAME} (${m.authorId.slice(0, 8)}…)`;
      console.log(`[req]   ${who}: ${m.text ?? '(no text)'}`);
    }
  }

  console.log('\n[req] done.');
  console.log('[req] note  The requester holds a ticket-scoped cap only — not space-wide access.');
}

main().catch((e) => {
  const err = e as Error & { status?: number };
  console.error('[req] fatal:', err.message);
  if (err.stack) {
    const frames = err.stack.split('\n').slice(1).join('\n');
    console.error(frames);
  }
  process.exit(1);
});
