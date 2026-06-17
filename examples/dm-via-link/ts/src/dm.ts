/**
 * OctoChat "DM me" link — start an end-to-end-encrypted 1:1 DM from a FRESH
 * identity, using nothing but the recipient's shareable profile link, with NO
 * space in common. Then send a message + an image + a file, and read the
 * conversation back.
 *
 *   new identity ──decode link──▶ token ──createDmViaLink──▶ dm space + room
 *        │                                                        │
 *        └── send: text · image attachment · file attachment ─────┤
 *                                                                  │
 *        fetch (pull + decrypt the append-log) ◀───────────────────┘
 *
 * A DM link (`…/dm#<token>`) is just the owner's IDENTITY made portable — their
 * userId, display pseudo and published public keys (Ed25519 + KEM), base64url-
 * packed into a URL fragment. Opening it reuses the normal DM machinery: a
 * private `dm-` space with a keyring, a member cap, and an anonymous sealed
 * delivery into the owner's inbox; here we only exercise the SENDER's side
 * (open + post + read-back), which is self-contained. The owner auto-accepts on
 * their own reconcile — see `packages/sdk/src/starfish/dm-link.e2e.test.ts` for
 * the full both-sides loop.
 *
 * UNLIKE the `stream-*-bot` examples (which use only the published, raw
 * `@drakkar.software/starfish-*` SDK), the DM flow — identity derivation,
 * keyring E2EE, the DM-link token, sealed-inbox delivery — lives in the
 * TypeScript `@drakkar.software/octochat-sdk`. That package isn't published, so
 * this example imports it BY RELATIVE PATH to its built entry in the repo and
 * runs against the workspace's hoisted dependencies (see ../README.md → Run).
 *
 * Run from the repo root (zero-install, reuses the workspace deps + tsx):
 *   STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
 *   STARFISH_URL=http://127.0.0.1:8799 \
 *     node_modules/.bin/tsx examples/dm-via-link/ts/src/dm.ts
 */
import { join } from 'node:path';

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

// The headless OctoChat core. Imported by relative path to its BUILT entry
// (`dist/index.js`) because the package is in-repo and unpublished; its own
// dependencies (`@drakkar.software/starfish-*`, `@noble/*`, …) resolve from the
// workspace's hoisted root `node_modules`. Rebuild it if stale:
//   pnpm --filter @drakkar.software/octochat-sdk build
import {
  configureKv,
  configureOctoChat,
  buildSession,
  createDmViaLink,
  decodeIdentityLink,
  ensureProfileKeys,
  getSpaceClient,
  loadAttachment,
  myIdentityLink,
  openEncryptor,
  ownerTrustedAdders,
  pullAndFold,
  randomId,
  readPeerKeys,
  streamRoomPush,
  streamRoomPull,
  uploadAttachment,
  userIdFromEdPub,
  type AttachmentRef,
  type ByteSealer,
  type IdentityLink,
  type Session,
  type StoredMsg,
  type StreamEnvelope,
} from '../../../../packages/sdk/dist/index.js';

// Load the example's shared `.env` (Node ≥20.12) from the example root (two
// levels up from this file); fall back to the real environment when absent.
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  /* no .env file — rely on exported env vars */
}

const SERVER = process.env.STARFISH_URL?.trim() || 'http://localhost:8787';
const NAMESPACE = process.env.STARFISH_NAMESPACE?.trim() || undefined;
/** A real user's DM link (`…/dm#<token>`). Omit to self-create a recipient so the
 *  example runs end-to-end against a fresh server with zero setup. */
const DM_LINK = process.env.DM_LINK?.trim() || '';
const SENDER_NAME = process.env.SENDER_NAME?.trim() || 'Reef Wanderer';
const RECIPIENT_NAME = process.env.RECIPIENT_NAME?.trim() || 'Coral Friend';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Maximum time (ms) to wait for a freshly-written profile to become readable.
 *  Remote/deployed servers may lag several seconds on read-after-write; 15 s
 *  covers realistic CDN/edge-cache propagation while failing fast locally. */
const PROFILE_PUBLISH_TIMEOUT_MS = 15_000;

/** A tiny but VALID payload for each attachment kind: a 1×1 transparent PNG
 *  (image) and a UTF-8 text blob (file). `uploadAttachment` derives `kind` from
 *  the mime, so the image renders as a thumbnail and the text as a file card. */
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const imageBytes = (): Uint8Array => new Uint8Array(Buffer.from(ONE_PX_PNG_B64, 'base64'));
const fileBytes = (): Uint8Array =>
  new TextEncoder().encode('Hello from the OctoChat DM example!\nThis rides E2EE as a file attachment.\n');

/** A fresh root-device session, WAITED until its profile keys are published.
 *  `buildSession` publishes them fire-and-forget (errors swallowed). We await an
 *  explicit `ensureProfileKeys` so a real write failure surfaces immediately
 *  (e.g. a 4xx from the deployed server) instead of a blind 5-second timeout.
 *  The call is idempotent — if the background publish already landed, it reads
 *  keys-present and returns without writing again. Then we poll until the write
 *  is visible, using `PROFILE_PUBLISH_TIMEOUT_MS` to cover remote read-after-write
 *  lag (CDN/edge-cache propagation) that a local server never hits.
 *  `createDmViaLink` cross-checks a link's embedded keys against the owner's
 *  published profile, so a recipient must be readable before its link is usable. */
async function newUser(name: string): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdFromEdPub(keys.edPub);
  const session = await buildSession({ userId, keys }, name);
  // Await the write explicitly — surfaces a real server error instead of a blind timeout.
  // A ConflictError (hash_mismatch) means buildSession's fire-and-forget background
  // publish won the write race; the keys ARE written — just continue to poll.
  await ensureProfileKeys(session.accountClient, userId, keys).catch((e: unknown) => {
    // hash_mismatch = ConflictError: buildSession's fire-and-forget background publish
    // won the write race; the keys ARE written — just continue to poll.
    if ((e as Error)?.message !== 'hash_mismatch') throw e;
  });
  const pollInterval = 150;
  const maxPolls = Math.ceil(PROFILE_PUBLISH_TIMEOUT_MS / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    if (await readPeerKeys(userId)) return session;
    if (i > 0 && i % 20 === 0)
      console.log(`[dm] …waiting for ${name}'s keys to read back (${i * pollInterval}ms / ${PROFILE_PUBLISH_TIMEOUT_MS}ms)`);
    await sleep(pollInterval);
  }
  throw new Error(`profile keys for ${name} published but not readable after ${PROFILE_PUBLISH_TIMEOUT_MS}ms`);
}

/** Decode a DM link to its token, accepting either a full `…/dm#<token>` URL or
 *  a bare fragment. */
function tokenFrom(link: string): IdentityLink {
  const i = link.indexOf('#');
  return decodeIdentityLink(i === -1 ? link : link.slice(i + 1));
}

async function main(): Promise<void> {
  configureOctoChat({ syncBase: SERVER, ...(NAMESPACE ? { syncNamespace: NAMESPACE } : {}) });
  // The SDK persists caps / registry / warm-start logs through a platform KV; an
  // in-memory Map is all a one-shot script needs.
  const mem = new Map<string, string>();
  configureKv({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void mem.delete(k),
  });

  console.log('[dm] OctoChat DM-via-link example');
  console.log(`[dm] server   ${SERVER}${NAMESPACE ? `  (namespace ${NAMESPACE})` : '  (local, no namespace)'}`);

  // 1) The recipient's DM link — a real one from the env, or a self-created
  //    identity so the example is runnable with zero setup.
  let link: string;
  if (DM_LINK) {
    link = DM_LINK;
    console.log('[dm] recipient via DM_LINK from the environment');
  } else {
    const recipient = await newUser(RECIPIENT_NAME);
    const minted = await myIdentityLink(recipient, 'https://octochat.app', 'dm');
    if (!minted) throw new Error('could not derive the recipient DM link');
    link = minted;
    console.log(`[dm] recipient created "${RECIPIENT_NAME}" (${recipient.userId.slice(0, 8)}…) → ${link}`);
  }
  const token = tokenFrom(link);
  const peerName = token.pseudo?.trim() || token.ownerId.slice(0, 8);

  // 2) The new identity that will do the messaging.
  const sender = await newUser(SENDER_NAME);
  console.log(`[dm] sender    "${SENDER_NAME}" (${sender.userId.slice(0, 8)}…)`);

  // 3) Open (or dedup into) the DM from the link. Verifies the offline identity
  //    binding + the live profile-key cross-check, mints the keyring + member cap,
  //    and delivers the sealed invite to the owner's inbox.
  console.log('[dm] step 3: createDmViaLink…');
  const { spaceId, roomId } = await createDmViaLink(sender, token, peerName);
  console.log(`[dm] opened DM with ${peerName} → space ${spaceId}`);

  // 4) The space keyring encryptor + sync client (sender opens as the DM owner).
  const client = getSpaceClient(spaceId, sender);
  const encryptor = await openEncryptor(client, sender.keys, spaceId, ownerTrustedAdders(sender));

  // Append one typed envelope, sealed with the space keyring. No client `ts` — the
  // server stamps an authoritative monotonic one (the point of an append-log room).
  const seal = encryptor as unknown as { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> };
  const append = async (env: StreamEnvelope): Promise<void> => {
    const body = await seal.encrypt(env as unknown as Record<string, unknown>);
    await client.append(streamRoomPush(roomId), body);
  };
  const sendText = (text: string) =>
    append({ t: 'msg', e: { id: randomId(), authorId: sender.userId, ts: Date.now(), text } });
  const sendAttachment = async (bytes: Uint8Array, name: string, mime: string): Promise<AttachmentRef> => {
    const attachment = await uploadAttachment(client, encryptor as unknown as ByteSealer, spaceId, bytes, name, mime);
    await append({ t: 'msg', e: { id: randomId(), authorId: sender.userId, ts: Date.now(), attachment } });
    return attachment;
  };

  // 5) Send an image attachment, a file attachment, and a text message.
  const img = await sendAttachment(imageBytes(), 'reef.png', 'image/png');
  console.log(`[dm] sent image  ${img.name} (${img.size} B, kind=${img.kind})`);
  const file = await sendAttachment(fileBytes(), 'hello.txt', 'text/plain');
  console.log(`[dm] sent file   ${file.name} (${file.size} B, kind=${file.kind})`);
  await sendText('Hey! 👋 Starting an encrypted DM straight from your link.');
  console.log('[dm] sent text   "Hey! 👋 …"');

  // 6) Fetch the conversation back: pull the append-log and decrypt with the same
  //    keyring. Reading an attachment fetches + decrypts its sealed blob.
  const { data } = await pullAndFold(client, encryptor, streamRoomPull(roomId));
  const ordered = [...data.messages].sort((a: StoredMsg, b: StoredMsg) => a.ts - b.ts);
  console.log(`[dm] fetched ${ordered.length} message(s) from the DM:`);
  for (const m of ordered) {
    const who = m.authorId === sender.userId ? SENDER_NAME : peerName;
    if (m.attachment) {
      const bytes = await loadAttachment(client, encryptor as unknown as ByteSealer, spaceId, m.attachment);
      console.log(`[dm]   ${who}: 📎 ${m.attachment.name} [${m.attachment.kind}] — ${bytes.length} B decrypted`);
    } else {
      console.log(`[dm]   ${who}: ${m.text ?? '(no text)'}`);
    }
  }
  console.log('[dm] done.');
}

main().catch((e) => {
  const err = e as Error & { status?: number };
  console.error('[dm] fatal:', err.message);
  if (err.stack) {
    // Strip the first line (already printed above) and show the call chain.
    const frames = err.stack.split('\n').slice(1).join('\n');
    console.error(frames);
  }
  process.exit(1);
});
