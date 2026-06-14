/**
 * Bot / integration write credentials for public stream rooms.
 *
 * Posting is a single `client.append` (POST /push) — no pull/merge/hash — which is
 * the whole point of a stream room: a bot pushes events without implementing the
 * read-modify-write sync protocol.
 */
import { unsealFromSelf, type SealedBlob } from './account-seal';
import type { Session } from './identity';

export interface StreamBotCredential {
  /** Always empty in the per-node access model. Kept for back-compat on stored credentials. */
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

