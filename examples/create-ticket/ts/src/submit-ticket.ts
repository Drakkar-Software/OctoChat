/**
 * OctoDesk — submit a ticket request to someone else's space.
 *
 * A fresh, non-member identity files a sealed "ticket" request into a space it does NOT belong
 * to, using ONLY the space owner's PUBLIC identity link — no cap, no secret, no membership. The
 * owner accepts it on their side (in the OctoChat app → "Incoming requests": review manually, or
 * auto-accept / auto-reply). This script is the REQUESTER half only.
 *
 *   requester (fresh identity; holds only OWNER_LINK)
 *     └── submitResourceRequest(ownerLink, { spaceId: SPACE_ID, nodeType:'ticket', title, meta, message })
 *           └─▶ sealed to the owner's KEM key ──▶ inbox/{ownerId}/{shard}   (public-write, no cap)
 *
 * Required env:
 *   OWNER_LINK   the owner's PUBLIC identity link — full `<origin>/request#<token>` or bare token.
 *                The owner shares it from OctoChat; it carries identity only (no secret).
 *   SPACE_ID     the owner's space to file into (e.g. `sp-48521ba9…`). The link does NOT encode it.
 * Optional env:
 *   STARFISH_URL / STARFISH_NAMESPACE   sync server (must match the owner's).
 *   TICKET_TITLE / TICKET_REQUESTER / TICKET_MESSAGE / REQUESTER_NAME
 *
 * Run from the repo root:
 *   pnpm --filter @drakkar.software/octochat-sdk build
 *   OWNER_LINK="https://desk.drakkar.software/request#…" SPACE_ID=sp-… \
 *   STARFISH_URL=https://dev-sync.drakkar.software/sync STARFISH_NAMESPACE=octospaces \
 *     node_modules/.bin/tsx examples/create-ticket/ts/src/submit-ticket.ts
 */
import { join } from 'node:path';

import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import {
  buildSession,
  configureKv,
  configureOctoChat,
  decodeIdentityLink,
  decodeRequestLink,
  ensureProfileKeys,
  readPeerKeys,
  submitResourceRequest,
  userIdFromEdPub,
  type Session,
} from '../../../../packages/sdk/dist/index.js';

// Load the example's shared `.env` from the example root (two levels up).
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  /* no .env file — rely on exported env vars */
}

const SERVER = process.env.STARFISH_URL?.trim() || 'http://localhost:8787';
const NAMESPACE = process.env.STARFISH_NAMESPACE?.trim() || undefined;
/** A combined request link `…/request?s=<spaceId>#<token>` (copied from the space's Requests card).
 *  When set it supplies BOTH the owner identity AND the target space — no OWNER_LINK/SPACE_ID needed. */
const REQUEST_LINK = process.env.REQUEST_LINK?.trim() || '';
/** The owner's PUBLIC identity link (full `…/request#<token>` or bare token). Used with SPACE_ID
 *  when no REQUEST_LINK is given. */
const OWNER_LINK = process.env.OWNER_LINK?.trim() || '';
/** The owner's space to file into — a bare identity link does NOT encode it. */
const SPACE_ID = process.env.SPACE_ID?.trim() || '';
const REQUESTER_NAME = process.env.REQUESTER_NAME?.trim() || 'Alice (requester)';
const TICKET_TITLE = process.env.TICKET_TITLE?.trim() || 'Login fails on Safari 17';
const TICKET_REQUESTER = process.env.TICKET_REQUESTER?.trim() || 'alice@example.com';
const TICKET_MESSAGE =
  process.env.TICKET_MESSAGE?.trim() ||
  'Hi! Safari 17.4 on macOS 14.5 returns 403 on /api/login. Chrome works fine.';

const PROFILE_PUBLISH_TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Create a fresh requester identity and wait until its profile keys are published + readable
 *  (the seal in submitResourceRequest cross-checks the requester's own published keys). */
async function newRequester(name: string): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdFromEdPub(keys.edPub);
  const session = await buildSession({ userId, keys }, name);
  await ensureProfileKeys(session.accountClient, userId, keys).catch((e: unknown) => {
    // hash_mismatch = ConflictError: buildSession's fire-and-forget won the race — keys ARE
    // written; just continue to poll.
    if ((e as Error)?.message !== 'hash_mismatch') throw e;
  });
  const pollInterval = 150;
  const maxPolls = Math.ceil(PROFILE_PUBLISH_TIMEOUT_MS / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    if (await readPeerKeys(userId)) return session;
    await sleep(pollInterval);
  }
  throw new Error(`profile keys for ${name} not readable after ${PROFILE_PUBLISH_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  // Resolve the owner identity + target space from a combined REQUEST_LINK (preferred) or from
  // OWNER_LINK + SPACE_ID. Both decode to the SAME v:2 identity token (the DM link's format too).
  let ownerLink;
  let spaceId: string;
  if (REQUEST_LINK) {
    const decoded = decodeRequestLink(REQUEST_LINK);
    if (!decoded.spaceId) {
      throw new Error('REQUEST_LINK has no target space (?s=…). Use the link from the space Requests card, or set OWNER_LINK + SPACE_ID.');
    }
    ownerLink = decoded.identity;
    spaceId = decoded.spaceId;
  } else {
    if (!OWNER_LINK) throw new Error('Set REQUEST_LINK (from the space Requests card), or OWNER_LINK + SPACE_ID.');
    if (!SPACE_ID) throw new Error("Set SPACE_ID (a bare identity link doesn't encode it), or use a combined REQUEST_LINK.");
    const i = OWNER_LINK.indexOf('#');
    ownerLink = decodeIdentityLink(i === -1 ? OWNER_LINK : OWNER_LINK.slice(i + 1));
    spaceId = SPACE_ID;
  }

  configureOctoChat({ syncBase: SERVER, ...(NAMESPACE ? { syncNamespace: NAMESPACE } : {}) });
  const mem = new Map<string, string>();
  configureKv({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void mem.delete(k),
  });

  console.log('[submit] OctoDesk — submit a ticket request');
  console.log(`[submit] server ${SERVER}${NAMESPACE ? `  (namespace ${NAMESPACE})` : '  (local)'}`);

  // ownerLink is identity-only — submitResourceRequest verifies its binding (kemSig) offline and
  // cross-checks it against the owner's live profile.
  console.log(`[submit] owner  ${ownerLink.ownerId.slice(0, 8)}…`);
  console.log(`[submit] space  ${spaceId}`);

  // A brand-new identity that is NOT a member of the owner's space and holds no cap.
  const requester = await newRequester(REQUESTER_NAME);
  console.log(`[submit] requester "${REQUESTER_NAME}" (${requester.userId.slice(0, 8)}…)  [fresh, non-member]`);

  const { reqId } = await submitResourceRequest(requester, ownerLink, {
    spaceId,
    nodeType: 'ticket',
    title: TICKET_TITLE,
    meta: { requester: TICKET_REQUESTER, priority: 'high' },
    message: TICKET_MESSAGE,
  });

  console.log(`[submit] submitted ✓  reqId=${reqId}`);
  console.log('[submit] Sealed into the owner\'s inbox. As the owner, open OctoChat (desk variant):');
  console.log('[submit]   • manual mode  → it appears under "Incoming requests" to accept/decline');
  console.log('[submit]   • auto-accept  → it becomes a ticket on your next app open');
  console.log('[submit]   • auto-reply   → it becomes a ticket with your first reply already posted');
}

main().catch((e) => {
  const err = e as Error & { status?: number };
  console.error('[submit] fatal:', err.message);
  if (err.stack) {
    const frames = err.stack.split('\n').slice(1).join('\n');
    console.error(frames);
  }
  process.exit(1);
});
