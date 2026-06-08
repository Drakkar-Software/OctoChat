/**
 * Bot / integration write credentials for PUBLIC stream rooms, built on Starfish's
 * dedicated public-link primitive (`createPublicLink` → an `audience` cap), NOT a
 * hand-rolled token. The audience cap carries NO secret: the bot generates its own
 * keypair and signs each request with it (`redeemPublicLink` → `X-Starfish-Pub`),
 * so a leaked link is useless without the bot's key. Optional allow-list + TTL.
 *
 * Posting is then a single `client.append` (POST /push) — no pull/merge/hash — which
 * is the whole point of a stream room: a bot pushes events without implementing the
 * read-modify-write sync protocol.
 *
 * Scope: PUBLIC (plaintext) stream rooms only. A PRIVATE (E2EE) stream room's writer
 * must seal with the space keyring, so a bot there is enrolled as a keyring member via
 * the normal space invite (see members.ts `inviteToSpace`) rather than a public link —
 * an audience link grants authority, not decryption.
 */
import { createPublicLink } from '@drakkar.software/starfish-sharing';

import { unsealFromSelf, type SealedBlob } from './account-seal';
import { getSyncBase } from '../config/config';
import type { Session } from './identity';
import { pubstreamRoomPush, pubstreamBotScope } from './paths';

export interface StreamBotCredential {
  /** The public-link fragment (an audience cap) — the bot's `parsePublicLink` input.
   *  Carries no private key; the bot signs with its own generated key. */
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
 * Owner: mint a bot write credential for ONE public stream room. The owner signs the
 * audience cap; the cap is scoped (least privilege) to just this room's append log.
 * `ttlSec` time-boxes it (recommended for bots); `allowedIdentities` optionally pins
 * which bot pubkeys may redeem (omit for "any holder of the link").
 */
export async function createStreamBotCredential(
  session: Session,
  ownerId: string,
  spaceId: string,
  roomId: string,
  opts: { ttlSec?: number; allowedIdentities?: string[] } = {},
): Promise<StreamBotCredential> {
  const nbf = Math.floor(Date.now() / 1000);
  const { fragment } = await createPublicLink({
    issEdPrivHex: session.keys.edPriv,
    issEdPubHex: session.keys.edPub,
    collection: 'pubstream',
    scope: pubstreamBotScope(ownerId, spaceId, roomId),
    nbf,
    ...(opts.ttlSec ? { ttlSec: opts.ttlSec } : {}),
    ...(opts.allowedIdentities ? { allowedIdentities: opts.allowedIdentities } : {}),
  });
  const signPath = pubstreamRoomPush(ownerId, spaceId, roomId);
  return {
    token: fragment,
    endpoint: `${getSyncBase()}${signPath}`,
    signPath,
    ...(opts.ttlSec ? { expiresAt: nbf + opts.ttlSec } : {}),
  };
}
