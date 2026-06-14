/**
 * Bot / integration write credentials for public stream rooms.
 *
 * In the per-node access model, public room writes go through `space:member` auth or
 * the webhook API. Audience caps for writing to public rooms are no longer supported.
 * `createStreamBotCredential` is kept for backward-compat but is deprecated — use
 * `createWebhook()` for external integrations instead.
 *
 * Posting is a single `client.append` (POST /push) — no pull/merge/hash — which is
 * the whole point of a stream room: a bot pushes events without implementing the
 * read-modify-write sync protocol.
 */
import { unsealFromSelf, type SealedBlob } from './account-seal';
import { getSyncBase } from '../config/config';
import type { Session } from './identity';
import { streamPubRoomPush } from './paths';

export interface StreamBotCredential {
  /** The public-link fragment (an audience cap) — the bot's `parsePublicLink` input.
   *  Carries no private key; the bot signs with its own generated key.
   *  @deprecated Always empty in the per-node access model. Use createWebhook() instead. */
  token: string;
  /** Full append endpoint the bot POSTs to (already namespace-prefixed). */
  endpoint: string;
  /** The path+query the bot must sign (what `redeemPublicLink` binds the signature to). */
  signPath: string;
  /** Absolute expiry (unix seconds) of the credential, if a TTL was set. */
  expiresAt?: number;
}

/** Open a stored automation bot credential. Current rooms store it SEALED to the owner
 *  key (`mintSealedCredential`) — unseal with the seed. A LEGACY room (created before
 *  the seal) stored the credential in the clear; detect that by its `token` and return
 *  it as-is so the automation keeps working until the owner rotates (which re-seals).
 *  No new exposure: a legacy credential was already plaintext in the synced doc. */
export async function openStreamBotCredential(
  session: Session,
  stored: SealedBlob | StreamBotCredential,
): Promise<StreamBotCredential> {
  if (typeof (stored as Partial<StreamBotCredential>).token === 'string') return stored as StreamBotCredential;
  return JSON.parse(await unsealFromSelf(session, stored as SealedBlob)) as StreamBotCredential;
}

/**
 * @deprecated External writes to public rooms should use the webhook API (createWebhook).
 *   For space-member automations, use the member cap directly with streamPubRoomPush.
 *
 * Returns path info for a public stream room's push endpoint. No audience cap is minted;
 * `token` is always empty. The `ownerId` parameter is ignored (path is derived from
 * `roomId` in the per-node model).
 */
export function createStreamBotCredential(
  session: Session,
  spaceId: string,
  roomId: string,
  opts: { ttlSec?: number; allowedIdentities?: string[] } = {},
): StreamBotCredential {
  void session; void spaceId; // unused in per-node model — kept for call-site compat
  void opts.allowedIdentities; // audience allow-list not supported without audience cap
  const signPath = streamPubRoomPush(roomId);
  return {
    token: '', // no audience cap — use createWebhook() for external bots
    endpoint: `${getSyncBase()}${signPath}`,
    signPath,
    ...(opts.ttlSec ? { expiresAt: Math.floor(Date.now() / 1000) + opts.ttlSec } : {}),
  };
}
