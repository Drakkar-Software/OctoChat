/**
 * OctoDesk "seed a viewable ticket" — create a ticket IN YOUR OWN OctoChat account so
 * you can open it in the app as the space owner and verify the owner-open / objinvlog
 * read path end-to-end.
 *
 * Unlike `request.ts` (a self-contained demo whose bot is a throwaway RANDOM identity in
 * its OWN space — you can never log into the app as it), this script derives the desk
 * identity from a BIP-39 SEED. Point it at YOUR app account's seed and a space that
 * account owns, and the ticket shows up in the app under that account.
 *
 * It writes the ticket message into the per-node invite log (`objinvlog`) via
 * `getNodeStreamClient` + `objInvLogPush` — the SAME stream + cap path the app's room
 * screen reads (see apps/mobile/src/lib/use-room.ts). `createTicketNode` establishes the
 * owner's per-node objinvlog cap at creation, and the app re-establishes it on open via
 * the owner self-heal, so a fresh app session reads the message back.
 *
 * Required env:
 *   AGENT_SEED       your OctoChat account's BIP-39 seed (space-separated words). The
 *                    ticket is created AS this identity. Omit to auto-generate one (it is
 *                    printed — import it into the app to view).
 * Optional env:
 *   SPACE_ID         an EXISTING space this identity OWNS (e.g. sp-48521ba9…). The ticket
 *                    is created there. Omit to create a fresh "Drakkar Support" space.
 *   STARFISH_URL     sync server (default http://localhost:8787).
 *   STARFISH_NAMESPACE / SHARED_SPACES_NAMESPACE  must match the app's env.
 *   TICKET_TITLE / TICKET_REQUESTER  ticket header fields.
 *
 * IMPORTANT: the app must run a variant whose `features` include `tickets` — the default
 * `octochat` variant does NOT (see apps/mobile/src/lib/variants.ts). Launch the app with
 * `EXPO_PUBLIC_VARIANT=octodesk` (or octopulse) or the Tickets shelf stays hidden.
 *
 * Run from the repo root:
 *   pnpm --filter @drakkar.software/octochat-sdk build
 *   AGENT_SEED="word1 word2 …" SPACE_ID=sp-… STARFISH_URL=https://dev-sync.drakkar.software/sync \
 *     STARFISH_NAMESPACE=octospaces node_modules/.bin/tsx examples/create-ticket/ts/src/seed-ticket.ts
 */
import { join } from 'node:path';

import {
  configureKv,
  configureOctoChat,
  createSpace,
  createTicketNode,
  defaultTicketMeta,
  deriveSession,
  ensureProfileKeys,
  generateSeedWords,
  getNodeStreamClient,
  isValidSeed,
  objInvLogPull,
  objInvLogPush,
  openEncryptor,
  pullAndFold,
  randomId,
  readPeerKeys,
  type Session,
  type StoredMsg,
  type StreamEnvelope,
} from '../../../../packages/sdk/dist/index.js';

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  /* no .env — rely on exported env vars */
}

const SERVER = process.env.STARFISH_URL?.trim() || 'http://localhost:8787';
const NAMESPACE = process.env.STARFISH_NAMESPACE?.trim() || undefined;
const SHARED_NS = process.env.SHARED_SPACES_NAMESPACE?.trim() || NAMESPACE;
const SPACE_ID = process.env.SPACE_ID?.trim() || '';
const AGENT_SEED_RAW = process.env.AGENT_SEED?.trim() || '';
const AGENT_NAME = process.env.AGENT_NAME?.trim() || 'Desk Owner';
const TICKET_TITLE = process.env.TICKET_TITLE?.trim() || 'Login fails on Safari 17';
const TICKET_REQUESTER = process.env.TICKET_REQUESTER?.trim() || 'alice@example.com';

const PROFILE_PUBLISH_TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolve the BIP-39 seed for the identity (AGENT_SEED, else auto-generate + print). */
function resolveSeed(): string[] {
  if (AGENT_SEED_RAW) {
    const words = AGENT_SEED_RAW.split(/\s+/);
    if (!isValidSeed(words)) throw new Error('AGENT_SEED is not a valid BIP-39 seed phrase');
    return words;
  }
  const words = generateSeedWords();
  console.log('[seed-ticket] seed   (no AGENT_SEED set — generated a fresh one)');
  console.log(`[seed-ticket] seed   ${words.join(' ')}`);
  console.log('[seed-ticket] seed   ↑ import this phrase into OctoChat to view the ticket as the owner');
  return words;
}

/** Derive a session and wait until its profile keys are published + readable. */
async function newUser(name: string): Promise<Session> {
  const session = await deriveSession(resolveSeed(), name);
  await ensureProfileKeys(session.accountClient, session.userId, session.keys).catch((e: unknown) => {
    if ((e as Error)?.message !== 'hash_mismatch') throw e;
  });
  const pollInterval = 150;
  const maxPolls = Math.ceil(PROFILE_PUBLISH_TIMEOUT_MS / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    if (await readPeerKeys(session.userId)) return session;
    await sleep(pollInterval);
  }
  throw new Error(`profile keys for ${name} not readable after ${PROFILE_PUBLISH_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  configureOctoChat({
    syncBase: SERVER,
    ...(NAMESPACE ? { syncNamespace: NAMESPACE } : {}),
    ...(SHARED_NS ? { sharedSpacesNamespace: SHARED_NS } : {}),
  });
  const mem = new Map<string, string>();
  configureKv({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void mem.delete(k),
  });

  console.log('[seed-ticket] create a viewable ticket in YOUR account');
  console.log(`[seed-ticket] server ${SERVER}${NAMESPACE ? `  (namespace ${NAMESPACE})` : '  (local)'}`);

  // 1) The desk identity = YOUR app account (derived from AGENT_SEED).
  const agent = await newUser(AGENT_NAME);
  console.log(`[seed-ticket] agent  "${AGENT_NAME}" (${agent.userId.slice(0, 8)}…)`);

  // 2) Target an existing owned space, or create a fresh one.
  let spaceId: string;
  if (SPACE_ID) {
    spaceId = SPACE_ID;
    console.log(`[seed-ticket] space  ${spaceId}  (existing — must be owned by this identity)`);
  } else {
    const space = await createSpace(agent, 'Drakkar Support');
    spaceId = space.id;
    console.log(`[seed-ticket] space  "${space.name}" created → ${spaceId}`);
  }

  // 3) Create the ticket node (plaintext, access:'invite'). This also establishes the
  //    owner's per-node objinvlog cap (ensureDeskTicketStreamAccess) so we can post below.
  const ticketId = `ticket-${randomId()}`;
  await createTicketNode(
    agent,
    spaceId,
    ticketId,
    defaultTicketMeta({ title: TICKET_TITLE, requester: TICKET_REQUESTER, priority: 'high' }),
    false,
  );
  console.log(`[seed-ticket] ticket created → ${ticketId}`);

  // 4) Post a message into the ticket's invite log (objinvlog) — exactly where the app reads.
  const client = getNodeStreamClient(spaceId, ticketId, agent);
  const env: StreamEnvelope = {
    t: 'msg',
    e: { id: randomId(), authorId: agent.userId, ts: Date.now(), text: `Re: ${TICKET_TITLE} — looking into this now. Can you confirm your browser version?` },
  };
  await client.append(objInvLogPush(spaceId, ticketId), env as unknown as Record<string, unknown>);
  console.log('[seed-ticket] posted  an opening message into the ticket');

  // 5) Read it back through the same path the app uses, to prove the round-trip.
  const passthrough = {
    encrypt: async <T>(d: T) => d as unknown as Record<string, unknown>,
    decrypt: async <T>(d: T) => d,
  } as unknown as Awaited<ReturnType<typeof openEncryptor>>;
  const { data } = await pullAndFold(client, passthrough, objInvLogPull(spaceId, ticketId));
  const msgs = [...data.messages].sort((a: StoredMsg, b: StoredMsg) => a.ts - b.ts);
  console.log(`[seed-ticket] readback  ${msgs.length} message(s) in objinvlog:`);
  for (const m of msgs) console.log(`[seed-ticket]   ${m.authorId.slice(0, 8)}…: ${m.text ?? '(no text)'}`);

  console.log('');
  console.log('[seed-ticket] ── next ──');
  console.log(`[seed-ticket] 1. open OctoChat signed in as the account for this seed`);
  console.log(`[seed-ticket] 2. run the app with EXPO_PUBLIC_VARIANT=octodesk (default octochat hides tickets)`);
  console.log(`[seed-ticket] 3. open space ${spaceId} → Tickets shelf → open "${TICKET_TITLE}"`);
  console.log('[seed-ticket] done.');
}

main().catch((e) => {
  const err = e as Error & { status?: number };
  console.error('[seed-ticket] fatal:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(1).join('\n'));
  process.exit(1);
});
