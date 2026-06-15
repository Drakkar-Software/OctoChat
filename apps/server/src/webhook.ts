/**
 * Inbound webhook ingestion → public room log (`objpublog`) (SELF-SERVICE).
 *
 * Lets an EXTERNAL system (CI, alerting pipeline, no-code automation, …) POST a
 * message that lands in a public room's log, with no OctoChat identity. Webhooks
 * are provisioned by the space OWNER from the app: the SDK (`createWebhook`) writes a
 * registry doc `spaces/{spaceId}/objects/owner/_webhooks` (gated `space:owner` via
 * `objowner` collection) mapping a webhookId → `{ tokenHash, roomId, … }`, storing
 * only the SHA-256 of a bearer token.
 *
 * This route reads that registry IN-PROCESS and authenticates a caller by hashing the
 * presented token and comparing — so no secret is shared with the operator, every
 * webhook has its own token, and the raw token lives only in the caller's system.
 *
 * The target room MUST be a public room (access:'public') — webhooks post into
 * `objpublog`. The room's `access` is taken from the owner-written registry entry
 * (`roomId` and access tier), never from the caller.
 *
 * The append is written in-process against the same store the sync router uses (like
 * the projection plugin), then published on `octospaces.log.changed.<spaceId>` so the
 * live SSE fan-out delivers it.
 */

import { Hono } from "hono";
import { ed25519 } from "@noble/curves/ed25519.js";
import { appendItem, type ObjectStore } from "@drakkar.software/starfish-server";
import { signAppendAuthor } from "@drakkar.software/starfish-protocol";
import type { Queue } from "@drakkar.software/starfish-queuing";

/** Provider-neutral inbound payload. `text` is required; `author` is optional
 *  display attribution for the external sender. */
export interface WebhookPayload {
  text: string;
  author?: string;
}

/** A stored webhook entry (only the token HASH and PUBLIC values are kept — never the
 *  raw token, and never a signing private key: the signer is derived from the token). */
interface WebhookEntry {
  tokenHash: string;
  roomId: string;
  label?: string;
  createdAt?: number;
  signEdPubHex?: string;
}

const ENC = new TextEncoder();
const TOKEN_HEADER = "x-webhook-token";
const MAX_BODY_BYTES = 65_536;
/** Domain tag for deriving a webhook's signing key from its token. MUST stay
 *  byte-identical to the SDK's derivation (packages/sdk/starfish/webhooks.ts). */
const SIGN_DOMAIN = "octochat-webhook-sign\n";
// Reject path segments that aren't simple ids — blocks store-key traversal AND keeps
// ids out of NATS subject tokens. NB: `.` is intentionally EXCLUDED (real OctoChat ids
// are hex / `sp-…` / `wh-…` and never contain it), so a segment can't inject an extra
// NATS subject token via `publishChange` (queue derives `<subject>.<spaceId>`).
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function sha256Hex(input: string): Promise<string> {
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", ENC.encode(input))));
}

/**
 * Derive the per-webhook Ed25519 signing keypair from its bearer token. The token is
 * the single root secret — there is NO operator/platform signing key, and no signing
 * private key is stored anywhere. `seed = SHA-256(SIGN_DOMAIN ‖ token)` is a 32-byte
 * Ed25519 seed; the SDK derived the same public key at creation. Only the holder of
 * the token (the legitimate caller) — or the server, transiently, when handed it — can
 * produce a valid author proof.
 */
async function deriveSigner(token: string): Promise<{ edPubHex: string; edPrivHex: string }> {
  const seed = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", ENC.encode(SIGN_DOMAIN + token)));
  return { edPrivHex: bytesToHex(seed), edPubHex: bytesToHex(ed25519.getPublicKey(seed)) };
}

/** Constant-time hex comparison (fixed expected length is not secret). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A path segment is safe iff it matches the id charset (which, excluding `.` and `/`,
 *  also rules out `.`/`..` traversal tokens and the empty segment). */
function safeSegment(s: string | undefined): s is string {
  return typeof s === "string" && SAFE_SEGMENT.test(s);
}

/** Strip an untrusted external author name to a safe, length-bounded display string. */
function sanitizeAuthorName(name: string): string {
  return name.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 64);
}

/** Read the owner-written webhook registry for a space, in-process.
 *  Registry lives at `spaces/{spaceId}/objects/owner/_webhooks` (objowner collection). */
async function readRegistry(store: ObjectStore, spaceId: string): Promise<Record<string, WebhookEntry>> {
  const raw = await store.getString(`spaces/${spaceId}/objects/owner/_webhooks`);
  if (!raw) return {};
  try {
    const doc = JSON.parse(raw) as { data?: { hooks?: Record<string, WebhookEntry> } };
    return doc.data?.hooks ?? {};
  } catch {
    return {};
  }
}

/** Map a payload to the stream envelope the chat UI renders: `{ t:'msg', e:{…} }`.
 *  `ts` is omitted — the append envelope's server timestamp is authoritative. The
 *  untrusted payload author is namespaced under `webhook:` so it can never collide
 *  with (impersonate) a real account id. */
export function buildStreamElement(payload: WebhookPayload, fallbackAuthorId: string): Record<string, unknown> {
  const claimed = typeof payload.author === "string" ? sanitizeAuthorName(payload.author) : "";
  const authorId = claimed.length > 0 ? `webhook:${claimed}` : fallbackAuthorId;
  return { t: "msg", e: { id: globalThis.crypto.randomUUID(), authorId, text: payload.text } };
}

/** Publish the change-event on the same subject a normal objpublog message uses. */
function publishChange(queue: Queue, spaceId: string, roomId: string, hash: string, timestamp: number): void {
  const msg = {
    collection: "objpublog",
    hash,
    timestamp,
    params: { spaceId, roomId },
    identity: `webhook:${spaceId}`,
  };
  void Promise.resolve(queue.publish("octospaces.log.changed", ENC.encode(JSON.stringify(msg)))).catch((e) => {
    console.warn(`[OctoChat] webhook change-event publish failed for ${spaceId}/${roomId}:`, e);
  });
}

export interface WebhookRouteOptions {
  store: ObjectStore;
  queue: Queue;
}

/** Build the `POST /webhook/:spaceId/:webhookId` route. Mount BEFORE the
 *  sync router's catch-all. */
export function createWebhookRoute(opts: WebhookRouteOptions): Hono {
  const app = new Hono();

  app.post("/webhook/:spaceId/:webhookId", async (c) => {
    const spaceId = c.req.param("spaceId");
    const webhookId = c.req.param("webhookId");
    // Reject anything that isn't a plain id BEFORE it reaches a store key.
    if (![spaceId, webhookId].every(safeSegment)) {
      return c.json({ error: "bad_request" }, 400);
    }

    // Bound the body before buffering/parsing (mounted ahead of the sync router).
    const declaredLen = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);

    const entry = (await readRegistry(opts.store, spaceId))[webhookId];
    if (!entry) return c.json({ error: "unknown_webhook" }, 404);

    const token = c.req.header(TOKEN_HEADER);
    if (!token) return c.json({ error: "missing_token" }, 401);
    if (!timingSafeEqualHex(await sha256Hex(token), entry.tokenHash)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!safeSegment(entry.roomId)) return c.json({ error: "webhook_misconfigured" }, 500);

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!payload || typeof payload.text !== "string" || payload.text.length === 0) {
      return c.json({ error: "missing_text" }, 400);
    }

    // Derive the per-webhook signing key from the (verified) token — no platform key.
    const signer = await deriveSigner(token);

    const element = buildStreamElement(payload, `webhook:${webhookId}`);
    // Public room log (objpublog): spaces/{spaceId}/objects/pub/{roomId}/log
    const documentKey = `spaces/${spaceId}/objects/pub/${entry.roomId}/log`;

    // Webhooks post plaintext to streampub — E2EE is strictly client-side; the server
    // must never seal message content.
    const author = signAppendAuthor(documentKey, element, signer.edPubHex, signer.edPrivHex);
    const outcome = await appendItem(opts.store, documentKey, element, "items", undefined, { author });
    if ("error" in outcome) return c.json(outcome, 409);

    publishChange(opts.queue, spaceId, entry.roomId, outcome.hash, outcome.timestamp);
    return c.json({ ok: true, timestamp: outcome.timestamp }, 200);
  });

  return app;
}
