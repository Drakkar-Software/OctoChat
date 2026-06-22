/**
 * DM key discovery: resolve a peer's PUBLIC identity keys from their public profile,
 * which is what the initiator needs to seal a DM-space keyring to them (`kemPub`) and
 * bind their member cap (`edPub`). The keys are published by {@link ensureProfileKeys}
 * on every root-device sign-in; an identity that hasn't opened the app since key
 * publishing shipped returns `null`, which the UI surfaces as "can't message yet".
 */
import { readProfile } from './client';

export interface PeerKeys {
  edPub: string;
  kemPub: string;
  /** Ed25519 signature of `kemPub` by the peer's `edPriv` — required by `parseJoinRequest`
   *  to prove `kemPub` is genuinely bound to `edPub`. Published by `ensureProfileKeys`. */
  kemSig: string;
}

/** A peer's `{edPub, kemPub, kemSig}`, or `null` when they haven't published keys yet (or
 *  the profile is unreachable). `kemSig` is published alongside the keys by `ensureProfileKeys`
 *  on every root-device sign-in; a profile without it can't be invited (the recipient
 *  self-heals on their next sign-in). Reads through the offline-first profile cache. */
export async function readPeerKeys(userId: string): Promise<PeerKeys | null> {
  const { edPub, kemPub, kemSig } = await readProfile(userId);
  return edPub && kemPub && kemSig ? { edPub, kemPub, kemSig } : null;
}
