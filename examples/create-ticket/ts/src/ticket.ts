/**
 * OctoDesk "create ticket" — create a support ticket from a FRESH agent
 * identity, send an initial reply with a file attachment, then enter a live
 * loop: poll every 10 s for new messages and let the agent type replies on stdin.
 *
 * Two modes, controlled by env vars:
 *
 *   NEW SPACE (default — zero setup, fully self-contained):
 *     agent identity ──createSpace──▶ desk space
 *          │                                │
 *          └── createTicket ───────────────▶ ticket room + requesterInviteLink
 *
 *   EXISTING SPACE (set SPACE_INVITE_LINK):
 *     agent identity ──joinSpaceByLink──▶ existing desk space
 *          │                                      │
 *          └── createTicket ────────────────────▶ ticket room + requesterInviteLink
 *
 * Either way, after the ticket is created:
 *   send attachment + text ──▶ patchTicketStatus('pending') ──▶ assignTicket
 *   ──▶ poll every 10 s (print new messages) + stdin (type to reply) ──▶ Ctrl+C to exit
 *
 * Run from the repo root (reuses workspace deps + tsx):
 *   pnpm --filter @drakkar.software/octochat-sdk build
 *   STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
 *   STARFISH_URL=http://127.0.0.1:8799 \
 *     node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
 */
import { createInterface } from 'node:readline';
import { join } from 'node:path';

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// The headless OctoChat core. Imported by relative path to its BUILT entry
// (`dist/index.js`). Rebuild if stale:
//   pnpm --filter @drakkar.software/octochat-sdk build
import {
  assignTicket,
  buildSession,
  configureKv,
  configureOctoChat,
  createSpace,
  createTicket,
  decodeSpaceInviteLink,
  ensureProfileKeys,
  getSpaceClient,
  joinSpaceByLink,
  loadAttachment,
  openEncryptor,
  ownerTrustedAdders,
  patchTicketStatus,
  pullAndFold,
  randomId,
  readPeerKeys,
  streamRoomPull,
  streamRoomPush,
  uploadAttachment,
  userIdFromEdPub,
  type AttachmentRef,
  type ByteSealer,
  type Session,
  type StoredMsg,
  type StreamEnvelope,
} from '../../../../packages/sdk/dist/index.js';

// Load `.env` from the example root (two levels up) if present.
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  /* no .env — rely on exported env vars */
}

const SERVER = process.env.STARFISH_URL?.trim() || 'http://localhost:8787';
const NAMESPACE = process.env.STARFISH_NAMESPACE?.trim() || undefined;
/** A `…/join#<token>` space invite link (or bare `#<token>`). Set this to add
 *  the fresh agent to a pre-existing OctoDesk space instead of creating a new one. */
const SPACE_INVITE_LINK = process.env.SPACE_INVITE_LINK?.trim() || '';
const SPACE_NAME = process.env.SPACE_NAME?.trim() || 'Drakkar Support';
const AGENT_NAME = process.env.AGENT_NAME?.trim() || 'Support Bot';
const TICKET_ORIGIN = process.env.TICKET_ORIGIN?.trim() || 'https://desk.drakkar.software';

/** How often to poll the ticket room for new messages (ms). */
const POLL_INTERVAL_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROFILE_PUBLISH_TIMEOUT_MS = 15_000;

/** A tiny but valid PNG (1×1 transparent pixel) to attach to the ticket. */
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const screenshotBytes = (): Uint8Array => new Uint8Array(Buffer.from(ONE_PX_PNG_B64, 'base64'));

/** Create a session for a fresh identity and wait until its profile keys are readable. */
async function newUser(name: string): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdFromEdPub(keys.edPub);
  const session = await buildSession({ userId, keys }, name);
  await ensureProfileKeys(session.accountClient, userId, keys).catch((e: unknown) => {
    if ((e as Error)?.message !== 'hash_mismatch') throw e;
  });
  const pollInterval = 150;
  const maxPolls = Math.ceil(PROFILE_PUBLISH_TIMEOUT_MS / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    if (await readPeerKeys(userId)) return session;
    if (i > 0 && i % 20 === 0)
      console.log(
        `[ticket] …waiting for ${name}'s keys to read back (${i * pollInterval}ms / ${PROFILE_PUBLISH_TIMEOUT_MS}ms)`,
      );
    await sleep(pollInterval);
  }
  throw new Error(`profile keys for ${name} not readable after ${PROFILE_PUBLISH_TIMEOUT_MS}ms`);
}

/** Format a StoredMsg for console output. */
function formatMsg(m: StoredMsg, agentId: string, agentName: string): string {
  const who = m.authorId === agentId ? agentName : `requester (${m.authorId.slice(0, 8)}…)`;
  if (m.attachment) {
    return `${who}: 📎 ${m.attachment.name} [${m.attachment.kind}] — ${m.attachment.size} B`;
  }
  return `${who}: ${m.text ?? '(no text)'}`;
}

async function main(): Promise<void> {
  configureOctoChat({ syncBase: SERVER, ...(NAMESPACE ? { syncNamespace: NAMESPACE } : {}) });
  const mem = new Map<string, string>();
  configureKv({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void mem.delete(k),
  });

  console.log('[ticket] OctoDesk create-ticket example');
  console.log(`[ticket] server   ${SERVER}${NAMESPACE ? `  (namespace ${NAMESPACE})` : '  (local, no namespace)'}`);

  // 1) Create a fresh agent identity that will act as the desk bot / support agent.
  const agent = await newUser(AGENT_NAME);
  console.log(`[ticket] agent    "${AGENT_NAME}" (${agent.userId.slice(0, 8)}…)`);

  // 2) Resolve the desk space — join an existing one via invite link, or create
  //    a new one. In production, the bot session holds a member cap for a
  //    pre-existing space (enrolled via the automation setup flow); supply
  //    SPACE_INVITE_LINK to exercise that path. Omit it and a fresh space is
  //    created so the example runs with zero prior state.
  let spaceId: string;
  if (SPACE_INVITE_LINK) {
    const i = SPACE_INVITE_LINK.indexOf('#');
    const fragment = i === -1 ? SPACE_INVITE_LINK : SPACE_INVITE_LINK.slice(i);
    const token = decodeSpaceInviteLink(fragment);
    const space = await joinSpaceByLink(agent, token);
    spaceId = space.id;
    console.log(`[ticket] joined   existing space → ${spaceId}`);
  } else {
    const space = await createSpace(agent, SPACE_NAME);
    spaceId = space.id;
    console.log(`[ticket] space    "${SPACE_NAME}" created → ${spaceId}`);
  }

  // 3) Create the ticket room. `createTicket` mints an ObjectNode (type: 'ticket'),
  //    attaches TicketMeta (status: open, priority: high), and returns a per-node
  //    invite link the requester can use to join just this ticket room.
  //    `memberTicket: false` (default) = plaintext node for external requesters.
  //    Switch to `true` for full E2EE when the requester is a space member.
  const { ticketId, requesterInviteLink } = await createTicket(agent, spaceId, {
    title: 'Login fails on Safari 17',
    requester: 'alice@example.com',
    priority: 'high',
    inviteLinkOrigin: TICKET_ORIGIN,
  });
  console.log(`[ticket] created  ticket ${ticketId}`);
  console.log(`[ticket] invite   ${requesterInviteLink}`);

  // 4) Open the space keyring + sync client.
  const client = getSpaceClient(spaceId, agent);
  const encryptor = await openEncryptor(client, agent.keys, spaceId, ownerTrustedAdders(agent));
  const sealer = encryptor as unknown as ByteSealer;
  const seal = encryptor as unknown as {
    encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  const append = async (env: StreamEnvelope): Promise<void> => {
    const body = await seal.encrypt(env as unknown as Record<string, unknown>);
    await client.append(streamRoomPush(ticketId), body);
  };

  const sendText = (text: string) =>
    append({ t: 'msg', e: { id: randomId(), authorId: agent.userId, ts: Date.now(), text } });

  const sendAttachment = async (
    bytes: Uint8Array,
    name: string,
    mime: string,
  ): Promise<AttachmentRef> => {
    const attachment = await uploadAttachment(client, sealer, ticketId, bytes, name, mime);
    await append({ t: 'msg', e: { id: randomId(), authorId: agent.userId, ts: Date.now(), attachment } });
    return attachment;
  };

  // 5) Send a screenshot attachment (uploaded + sealed before it leaves the client),
  //    then an initial text reply.
  const screenshot = await sendAttachment(screenshotBytes(), 'safari-error.png', 'image/png');
  console.log(`[ticket] sent     attachment ${screenshot.name} (${screenshot.size} B, kind=${screenshot.kind})`);

  await sendText(
    'Hi Alice! I can reproduce this — looking into it now. Could you share your Safari version?',
  );
  console.log('[ticket] sent     initial reply');

  // 6) Update status + assign.
  await patchTicketStatus(agent, spaceId, ticketId, 'pending');
  console.log('[ticket] status   open → pending');
  await assignTicket(agent, spaceId, ticketId, agent.userId);
  console.log(`[ticket] assigned → ${agent.userId.slice(0, 8)}… (${AGENT_NAME})`);

  // 7) Initial fetch — print everything in the room so far.
  const seen = new Set<string>();
  const initialPull = await pullAndFold(client, encryptor, streamRoomPull(ticketId));
  const initialMsgs = [...initialPull.data.messages].sort(
    (a: StoredMsg, b: StoredMsg) => a.ts - b.ts,
  );
  console.log(`\n[ticket] ── conversation (${initialMsgs.length} message(s)) ──`);
  for (const m of initialMsgs) {
    seen.add(m.id);
    if (m.attachment) {
      const bytes = await loadAttachment(client, sealer, ticketId, m.attachment);
      console.log(`[ticket]   ${formatMsg(m, agent.userId, AGENT_NAME)}  (${bytes.length} B decrypted)`);
    } else {
      console.log(`[ticket]   ${formatMsg(m, agent.userId, AGENT_NAME)}`);
    }
  }

  // 8) Live loop: poll every POLL_INTERVAL_MS and accept stdin replies.
  console.log(`\n[ticket] ── live (polling every ${POLL_INTERVAL_MS / 1000}s · type to reply · Ctrl+C to quit) ──`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  // Poll timer — runs in the background; prints any messages not yet in `seen`.
  const pollTimer = setInterval(async () => {
    try {
      const { data } = await pullAndFold(client, encryptor, streamRoomPull(ticketId));
      const fresh = [...data.messages]
        .filter((m: StoredMsg) => !seen.has(m.id))
        .sort((a: StoredMsg, b: StoredMsg) => a.ts - b.ts);
      for (const m of fresh) {
        seen.add(m.id);
        console.log(`[ticket]   ${formatMsg(m, agent.userId, AGENT_NAME)}`);
      }
    } catch (e: unknown) {
      console.error('[ticket] poll error:', (e as Error).message);
    }
  }, POLL_INTERVAL_MS);

  // Stdin — each non-empty line is a new ticket message from the agent.
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    void sendText(text).then(() => {
      console.log('[ticket]   (message sent)');
    });
  });

  // Wait until the user closes stdin (Ctrl+C / Ctrl+D / pipe end).
  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      clearInterval(pollTimer);
      resolve();
    });
  });

  console.log('[ticket] done.');
}

main().catch((e) => {
  const err = e as Error & { status?: number };
  console.error('[ticket] fatal:', err.message);
  if (err.stack) {
    const frames = err.stack.split('\n').slice(1).join('\n');
    console.error(frames);
  }
  process.exit(1);
});
