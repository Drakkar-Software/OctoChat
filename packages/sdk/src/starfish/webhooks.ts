/**
 * Self-service inbound-webhook provisioning for a PUBLIC space.
 *
 * Lets a space OWNER mint their own inbound webhooks from the app — no operator and
 * no shared secret. Each webhook gets a unique high-entropy token; the app stores
 * only its SHA-256 hash in an owner-written registry doc
 * (`pubspaces/{ownerId}/{spaceId}/_webhooks`, gated `pubspace:owner`). The server's
 * inbound `/webhook` route reads that registry in-process and authenticates a caller
 * by hashing the presented token and comparing — so the raw token lives only in the
 * external system the owner pastes it into, never at rest here.
 *
 * The token is a BEARER credential (like a Slack incoming-webhook URL): it is shown
 * once at creation and cannot be recovered — only revoked (which removes its hash) or
 * rotated (create a new one, delete the old). Treat it like a password; it must only
 * ever travel over TLS.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { StarfishHttpError } from '@drakkar.software/starfish-client';
import { ed25519 } from '@noble/curves/ed25519.js';

import { randomId } from '../domain/ids';
import { pubspaceWebhooksPull, pubspaceWebhooksPush } from './paths';

/** Header the external caller sends the raw token in. */
export const WEBHOOK_TOKEN_HEADER = 'X-Webhook-Token';

/** Soft cap on webhooks per space. The registry is also hard-bounded server-side by
 *  the collection's `maxBodyBytes`; this rejects earlier with a clear message and
 *  keeps the per-inbound-request registry read small. */
export const MAX_WEBHOOKS_PER_SPACE = 50;

/** A stored webhook entry. Only the token HASH is kept — the raw token is never
 *  persisted, and the per-webhook signing PRIVATE key is never stored (it is derived
 *  from the token at POST time). Only public values live here. */
export interface WebhookEntry {
  /** Lowercase-hex SHA-256 of the bearer token. */
  tokenHash: string;
  /** The room this webhook posts into. */
  roomId: string;
  /** Human label shown in the management UI. */
  label: string;
  createdAt: number;
  /** The per-webhook Ed25519 signing PUBLIC key (hex), derived from the token. Public;
   *  lets a sealed-room reader pin it as the required sealer and identify the author. */
  signEdPubHex: string;
  /** Optional E2EE: the published space write key (X25519 pub hex). When set, the
   *  server seals each posted message to it. */
  sealKemPubHex?: string;
}

/** The registry document shape. */
export interface WebhooksDoc {
  v: 1;
  hooks: Record<string, WebhookEntry>;
}

/** A webhook as surfaced to the management UI (never carries the token). */
export interface WebhookSummary {
  id: string;
  roomId: string;
  label: string;
  createdAt: number;
  sealed: boolean;
  /** The webhook's signing public key (hex) — pin this as the sealer to read a sealed room. */
  signerPubHex: string;
}

/** The one-time result of creating a webhook — the token is returned ONCE. */
export interface CreatedWebhook {
  id: string;
  /** The raw bearer token. Show once; it cannot be recovered later. */
  token: string;
  /** The header the caller must send the token in. */
  tokenHeader: string;
  /** The webhook's signing public key (hex), derived from the token. Stable per
   *  webhook; share it with members who need to pin the sealer on a sealed room. */
  signerPubHex: string;
}

const ENC = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** SHA-256 of a UTF-8 string → lowercase hex. Shared shape with the server verifier. */
export async function webhookTokenHash(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', ENC.encode(token));
  return toHex(new Uint8Array(digest));
}

/** A fresh 256-bit bearer token (hex). */
function randomToken(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** Domain-separation tag for deriving the per-webhook SIGNING key from the token.
 *  MUST stay byte-identical to the server's derivation (apps/server/webhook.ts). */
const SIGN_DOMAIN = 'octochat-webhook-sign\n';

/**
 * Derive the per-webhook Ed25519 signing keypair from its bearer token. The token
 * (256-bit random) is the single root secret: the server re-derives the same key at
 * POST time to sign the append-author proof, so NO platform key and NO private key at
 * rest are needed. `seed = SHA-256(SIGN_DOMAIN ‖ token)` is a 32-byte Ed25519 seed.
 */
async function deriveSignerSeed(token: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', ENC.encode(SIGN_DOMAIN + token)));
}

/** The public half of {@link deriveSignerSeed} (hex) — stored in the registry so a
 *  sealed-room reader can pin it as the required sealer, and to identify the author. */
export async function deriveWebhookSignerPubHex(token: string): Promise<string> {
  return toHex(ed25519.getPublicKey(await deriveSignerSeed(token)));
}

async function readWebhooksDoc(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<{ hooks: Record<string, WebhookEntry>; hash: string | null }> {
  // 404 → empty registry; any other error propagates (offline must not look "empty").
  const res = await client.pull(pubspaceWebhooksPull(ownerId, spaceId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as Partial<WebhooksDoc> | undefined;
  const hooks =
    data && typeof data.hooks === 'object' && data.hooks !== null
      ? (data.hooks as Record<string, WebhookEntry>)
      : {};
  return { hooks, hash: res?.hash ?? null };
}

/** List a space's webhooks (no tokens — only hashes are stored), newest first. */
export async function listWebhooks(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<WebhookSummary[]> {
  const { hooks } = await readWebhooksDoc(client, ownerId, spaceId);
  return Object.entries(hooks)
    .map(([id, e]) => ({
      id,
      roomId: e.roomId,
      label: e.label,
      createdAt: e.createdAt,
      sealed: !!e.sealKemPubHex,
      signerPubHex: e.signEdPubHex ?? '',
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Mint a webhook for `roomId`. Generates a token, stores only its hash, and returns
 * the raw token ONCE. Writes the registry with the owner's cap (optimistic-concurrency
 * on the pulled hash, so concurrent edits conflict rather than clobber).
 */
export async function createWebhook(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
  opts: { roomId: string; label: string; sealKemPubHex?: string },
): Promise<CreatedWebhook> {
  const { hooks, hash } = await readWebhooksDoc(client, ownerId, spaceId);
  if (Object.keys(hooks).length >= MAX_WEBHOOKS_PER_SPACE) {
    throw new Error(`Webhook limit reached (${MAX_WEBHOOKS_PER_SPACE} per space). Revoke one first.`);
  }
  const id = `wh-${randomId()}`;
  const token = randomToken();
  const signEdPubHex = await deriveWebhookSignerPubHex(token);
  const entry: WebhookEntry = {
    tokenHash: await webhookTokenHash(token),
    roomId: opts.roomId,
    label: opts.label,
    createdAt: Date.now(),
    signEdPubHex,
    ...(opts.sealKemPubHex ? { sealKemPubHex: opts.sealKemPubHex } : {}),
  };
  const next: WebhooksDoc = { v: 1, hooks: { ...hooks, [id]: entry } };
  await client.push(pubspaceWebhooksPush(ownerId, spaceId), next as unknown as Record<string, unknown>, hash);
  return { id, token, tokenHeader: WEBHOOK_TOKEN_HEADER, signerPubHex: signEdPubHex };
}

/** Revoke a webhook by id (removes its hash; the token can never be used again). */
export async function removeWebhook(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
  webhookId: string,
): Promise<void> {
  const { hooks, hash } = await readWebhooksDoc(client, ownerId, spaceId);
  if (!(webhookId in hooks)) return;
  const next: Record<string, WebhookEntry> = {};
  for (const [id, e] of Object.entries(hooks)) if (id !== webhookId) next[id] = e;
  await client.push(
    pubspaceWebhooksPush(ownerId, spaceId),
    { v: 1, hooks: next } as unknown as Record<string, unknown>,
    hash,
  );
}

/** The URL the owner pastes into the external system, for a given server base URL. */
export function webhookUrl(baseUrl: string, ownerId: string, spaceId: string, webhookId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/webhook/${ownerId}/${spaceId}/${webhookId}`;
}
