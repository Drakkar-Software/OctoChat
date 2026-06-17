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

// The headless OctoChat core. Imported by relative path to its BUILT entry
// (`dist/index.js`). Rebuild if stale:
//   pnpm --filter @drakkar.software/octochat-sdk build
import {
  SpaceAccessError,
  assignTicket,
  configureKv,
  configureOctoChat,
  createSpace,
  createTicket,
  createTicketNode,
  decodeSpaceInviteLink,
  defaultTicketMeta,
  deriveSession,
  ensureProfileKeys,
  generateSeedWords,
  getSpaceClient,
  isValidSeed,
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
/** Optional BIP-39 seed phrase (space-separated words). When set the agent identity is
 *  derived deterministically — the same userId across runs. Set this to your OctoChat
 *  account's seed to view the created space and ticket as the space owner in the app.
 *  Leave unset to auto-generate a fresh seed (printed so you can import it). */
const AGENT_SEED_RAW = process.env.AGENT_SEED?.trim() || '';

/** How often to poll the ticket room for new messages (ms). */
const POLL_INTERVAL_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROFILE_PUBLISH_TIMEOUT_MS = 15_000;

/** A tiny but valid PNG (1×1 transparent pixel) to attach to the ticket. */
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const screenshotBytes = (): Uint8Array => new Uint8Array(Buffer.from(ONE_PX_PNG_B64, 'base64'));

/** Resolve the BIP-39 seed for the agent identity.
 *  Uses `AGENT_SEED` if set (validates it), otherwise auto-generates and prints one. */
function resolveAgentSeed(): string[] {
  if (AGENT_SEED_RAW) {
    const words = AGENT_SEED_RAW.split(/\s+/);
    if (!isValidSeed(words)) throw new Error('AGENT_SEED is not a valid BIP-39 seed phrase');
    return words;
  }
  const words = generateSeedWords();
  console.log('[ticket] seed     (no AGENT_SEED set — generated a fresh one)');
  console.log(`[ticket] seed     ${words.join(' ')}`);
  console.log('[ticket] seed     ↑ set AGENT_SEED to this phrase to reuse the same identity');
  console.log('[ticket] seed     ↑ import it into OctoChat to view the ticket as the space owner');
  return words;
}

/** Derive a session for the agent identity and wait until its profile keys are readable. */
async function newUser(name: string): Promise<Session> {
  const seed = resolveAgentSeed();
  const session = await deriveSession(seed, name);
  await ensureProfileKeys(session.accountClient, session.userId, session.keys).catch((e: unknown) => {
    if ((e as Error)?.message !== 'hash_mismatch') throw e;
  });
  const pollInterval = 150;
  const maxPolls = Math.ceil(PROFILE_PUBLISH_TIMEOUT_MS / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    if (await readPeerKeys(session.userId)) return session;
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
    const fragment = i === -1 ? SPACE_INVITE_LINK : SPACE_INVITE_LINK.slice(i + 1);
    const token = decodeSpaceInviteLink(fragment);
    const space = await joinSpaceByLink(agent, token);
    spaceId = space.id;
    console.log(`[ticket] joined   existing space → ${spaceId}`);
  } else {
    const space = await createSpace(agent, SPACE_NAME);
    spaceId = space.id;
    console.log(`[ticket] space    "${SPACE_NAME}" created → ${spaceId}`);
  }

  // 3) Create the ticket room.
  //
  //    OWNER PATH (new space, or existing space where the agent is the owner):
  //      `createTicket` mints an ObjectNode, attaches TicketMeta, and calls
  //      `createNodeInviteLink` — which requires owner-level access to the space
  //      member roster. Returns a `requesterInviteLink` for the non-member requester.
  //
  //    MEMBER PATH (joined via SPACE_INVITE_LINK — regular member, not owner):
  //      `createNodeInviteLink` would 403 (reading the member roster is owner-only).
  //      Use `createTicketNode` directly instead — this writes the ticket object
  //      into the space's object index (member-writable) without issuing an invite.
  //      No `requesterInviteLink` is generated; the requester would need to be
  //      added by the space owner separately.
  const TICKET_TITLE = 'Login fails on Safari 17';
  const TICKET_REQUESTER = 'alice@example.com';
  const ticketId = `ticket-${randomId()}`;

  let requesterInviteLink: string | null = null;

  if (SPACE_INVITE_LINK) {
    // Member path — just create the node, no invite link.
    await createTicketNode(
      agent,
      spaceId,
      ticketId,
      defaultTicketMeta({ title: TICKET_TITLE, requester: TICKET_REQUESTER, priority: 'high' }),
      false,
    );
    console.log(`[ticket] created  ticket ${ticketId}  (member mode — no requester invite link)`);
  } else {
    // Owner path — full createTicket with requester invite link.
    const result = await createTicket(agent, spaceId, {
      title: TICKET_TITLE,
      requester: TICKET_REQUESTER,
      priority: 'high',
      inviteLinkOrigin: TICKET_ORIGIN,
    });
    requesterInviteLink = result.requesterInviteLink;
    console.log(`[ticket] created  ticket ${result.ticketId}`);
    console.log(`[ticket] invite   ${requesterInviteLink}`);
  }

  // 4) Open the space keyring + sync client.
  //    For member-joined sessions (SPACE_INVITE_LINK path), the member may not
  //    be a keyring recipient — joinSpaceByLink grants a cap but the owner must
  //    separately add them to the keyring. For enc: false (plaintext) tickets,
  //    no keyring is needed at all, so we fall back to a passthrough encryptor
  //    on SpaceAccessError and skip attachment upload (which always seals bytes).
  const client = getSpaceClient(spaceId, agent);
  type RawEncryptor = Awaited<ReturnType<typeof openEncryptor>>;
  const encryptorOrNull = await openEncryptor(
    client, agent.keys, spaceId, ownerTrustedAdders(agent),
  ).catch((e: unknown) => {
    if (!(e instanceof SpaceAccessError)) throw e;
    return null;
  });
  const hasCrypto = encryptorOrNull !== null;
  const encryptor: RawEncryptor = encryptorOrNull ?? ({
    encrypt: async <T>(d: T) => d as unknown as Record<string, unknown>,
    decrypt: async <T>(d: T) => d,
  } as unknown as RawEncryptor);
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
    const attachment = await uploadAttachment(client, sealer, spaceId, bytes, name, mime);
    await append({ t: 'msg', e: { id: randomId(), authorId: agent.userId, ts: Date.now(), attachment } });
    return attachment;
  };

  // 5) Send a screenshot attachment (uploaded + sealed before it leaves the client),
  //    then an initial text reply.
  //    Skip the attachment in member mode — uploadAttachment always seals with the
  //    space keyring regardless of enc setting, so it would fail without keyring access.
  if (hasCrypto) {
    const screenshot = await sendAttachment(screenshotBytes(), 'safari-error.png', 'image/png');
    console.log(`[ticket] sent     attachment ${screenshot.name} (${screenshot.size} B, kind=${screenshot.kind})`);
  } else {
    console.log('[ticket] note     attachment skipped (no keyring — member mode, enc: false ticket)');
  }

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
    if (m.attachment && hasCrypto) {
      const bytes = await loadAttachment(client, sealer, spaceId, m.attachment);
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
