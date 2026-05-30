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
}

/** A peer's `{edPub, kemPub}`, or `null` when they haven't published keys yet (or the
 *  profile is unreachable). Reads through the offline-first profile cache. */
export async function readPeerKeys(userId: string): Promise<PeerKeys | null> {
  const { edPub, kemPub } = await readProfile(userId);
  return edPub && kemPub ? { edPub, kemPub } : null;
}
