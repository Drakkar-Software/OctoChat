/**
 * Device pairing (one-way, PIN-sealed). The existing device provisions a new
 * device's keypair + cap bundle, seals it with the PIN (Argon2id → AES-GCM), and
 * drops it on the public `_pairing/<nonce>` rendezvous. The QR carries only the
 * nonce; the new device fetches the sealed blob, opens it with the PIN, and
 * validates the cap bundle. This proves the cryptographic handshake end-to-end.
 *
 * `startDevicePairing` is OctoChat-specific: it also grants the new device to every
 * owned space's E2EE keyring so it can decrypt those rooms immediately. The generic
 * `completeDevicePairing` and `PairResult` are re-exported from octospaces-sdk.
 */
import {
  startDevicePairing as _startDevicePairing,
} from '@drakkar.software/octospaces-sdk';

import type { Session } from './identity';
import { addDeviceToSpaceKeyring } from './members';
import { readSpaces } from './registry';

// OctoChat keeps its own QR prefix so cross-app scans are rejected rather than
// silently attempted. The octospaces-sdk completeDevicePairing accepts any *-pair:
// prefix via its dual-accept logic — so existing OctoChat QR codes keep working.
export const PAIR_PREFIX = 'octochat-pair:';

// completeDevicePairing and PairResult are identical to the SDK's — re-export.
export type { PairResult } from '@drakkar.software/octospaces-sdk';
export { completeDevicePairing } from '@drakkar.software/octospaces-sdk';

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
      const { spaces, caps } = await readSpaces(session.spacesRegistryClient, session.userId);
      for (const space of spaces) {
        if (caps[space.id]) continue; // joined (has a member cap) — not ours to grant
        try {
          await addDeviceToSpaceKeyring(session, space.id, { kemPub: device.kemPub, edPub: device.edPub, userId: session.userId });
        } catch (err) {
          // Best-effort per space — a single keyring failure must not abort pairing.
          console.log('[pairing] keyring grant failed', { spaceId: space.id, error: String((err as Error)?.message ?? err) });
        }
      }
    },
  });
}
