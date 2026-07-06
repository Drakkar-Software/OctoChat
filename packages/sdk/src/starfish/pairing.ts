/**
 * Device pairing (one-way, PIN-sealed). The existing device provisions a new
 * device's keypair + cap bundle, seals it with the PIN (Argon2id → AES-GCM), and
 * drops it on the public `_pairing/<nonce>` rendezvous. The QR carries only the
 * nonce; the new device fetches the sealed blob, opens it with the PIN, and
 * validates the cap bundle. This proves the cryptographic handshake end-to-end.
 *
 * `startDevicePairing` is OctoChat-specific: it also grants the new device to every
 * owned space's E2EE keyring so it can decrypt those rooms immediately. The generic
 * `completeDevicePairing` and `PairResult` come directly from starfish-spaces —
 * dk-spaces-sdk 0.30 stopped wrapping device pairing.
 *
 * starfish alpha.63 made root-trust MANDATORY on pairing completion: the receiving
 * device must pass `expectedRootEdPub` (a pinned root key) or `confirmUnpinnedRoot`
 * (a callback), else `completeDevicePairing` throws. OctoChat has no prior-pinned
 * root to check against here (the new device is bootstrapping FROM this scan), so
 * `confirmUnpinnedRoot` always trusts — the actual security boundary is the
 * PIN-sealed bundle + physical QR proximity, same as before this change.
 */
import {
  startDevicePairing as _startDevicePairing,
  completeDevicePairing as _completeDevicePairing,
  type PairResult,
} from '@drakkar.software/starfish-spaces';
import { pairingClientConfig } from '@drakkar.software/dk-spaces-sdk';

import type { Session } from './identity';
import { addDeviceToSpaceKeyring } from './members';
import { readSpaces } from './registry';

// OctoChat keeps its own QR prefix so cross-app scans are rejected rather than
// silently attempted. starfish-spaces' completeDevicePairing accepts any *-pair:
// prefix via its dual-accept logic — so existing OctoChat QR codes keep working.
export const PAIR_PREFIX = 'octochat-pair:';

export type { PairResult };

/** New device: open the sealed bundle at the rendezvous nonce and install it. */
export async function completeDevicePairing(payload: string, pin: string): Promise<PairResult> {
  return _completeDevicePairing(payload, pin, {
    ...pairingClientConfig(),
    confirmUnpinnedRoot: () => true,
  });
}

/** Existing device: provision + PIN-seal a new device, publish to rendezvous, return the QR payload. */
export async function startDevicePairing(session: Session, pin: string): Promise<string> {
  return _startDevicePairing(session, pin, {
    prefix: PAIR_PREFIX,
    onProvisioned: async (device) => {
      // Grant ONE cap-cert broad enough to drive both the chat and account clients on
      // the paired device. Make the new device a recipient of every keyring this user
      // OWNS so it can decrypt those spaces immediately. A keyring write is
      // `space:owner`-gated, so we can only grant OWNED spaces — joined spaces stay
      // locked until their owner re-invites this device.
      //
      // The entire block is best-effort: if readSpaces fails (network error) we log
      // and return — pairing must succeed regardless of keyring grants.
      try {
        const { spaces, caps } = await readSpaces(session.spacesRegistryClient, session);
        const ownedSpaces = spaces.filter(s => !caps[s.id]); // joined spaces have a member cap
        await Promise.all(
          ownedSpaces.map(space =>
            addDeviceToSpaceKeyring(session, space.id, { kemPub: device.kemPub, edPub: device.edPub, userId: session.userId })
              .catch(err => console.log('[pairing] keyring grant failed', { spaceId: space.id, error: String((err as Error)?.message ?? err) })),
          ),
        );
      } catch (err) {
        console.log('[pairing] readSpaces failed, skipping keyring grants', String((err as Error)?.message ?? err));
      }
    },
  });
}
