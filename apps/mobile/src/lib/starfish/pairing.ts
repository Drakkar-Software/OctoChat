/**
 * Device pairing (one-way, PIN-sealed). The existing device provisions a new
 * device's keypair + cap bundle, seals it with the PIN (Argon2id → AES-GCM), and
 * drops it on the public `_pairing/<nonce>` rendezvous. The QR carries only the
 * nonce; the new device fetches the sealed blob, opens it with the PIN, and
 * validates the cap bundle. This proves the cryptographic handshake end-to-end.
 *
 * Promoting a paired device to a full multi-room session reuses the per-room
 * keyring-recipient mechanism (see members.ts) and is a follow-up.
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import {
  installPairingBundle,
  openWithPassphrase,
  provisionDevice,
  sealWithPassphrase,
} from '@drakkar.software/starfish-identities';
import type { CapCert } from '@drakkar.software/starfish-protocol';

import type { DeviceKeys } from './client';
import { SYNC_BASE, SYNC_NAMESPACE } from './config';
import { fetchWithTimeout } from './fetch-timeout';
import type { Session } from './identity';
import { fingerprintFromUserId } from './identity';
import { addDeviceToSpaceKeyring } from './members';
import { bytesToHex, linkedDeviceScope } from './paths';
import { readSpaces } from './registry';

export const PAIR_PREFIX = 'octochat-pair:';

// Linked-device cap-cert lifetime. `provisionDevice` defaults to 30 days, after
// which the paired session's cap expires and it must be re-paired. A year keeps a
// linked device usable long-term without a silent cap-refresh mechanism.
const LINKED_DEVICE_TTL_SEC = 365 * 24 * 60 * 60;

function anonClient(): StarfishClient {
  // Namespaced like every other client (see makeClient): the `_pairing` rendezvous
  // lives under the same `/v1/octochat` namespace on the deployed server, so the
  // anonymous push/pull must carry it too. Undefined locally (paths unchanged).
  return new StarfishClient({ baseUrl: SYNC_BASE, namespace: SYNC_NAMESPACE, fetch: fetchWithTimeout() });
}

function randomNonce(): string {
  // CSPRNG: the nonce is the only locator for the public `_pairing/<nonce>` slot,
  // so it must be unguessable. (The blob is also PIN-sealed.) Hex keeps it URL-safe.
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** Existing device: provision + PIN-seal a new device, publish to rendezvous, return the QR payload. */
export async function startDevicePairing(session: Session, pin: string): Promise<string> {
  // Grant ONE cap-cert broad enough to drive both the chat and account clients on
  // the paired device (it can't self-mint — its keypair ≠ root), so the new device
  // can read its `_spaces` registry, profile and owned spaces straight away.
  const { deviceKeys, bundle } = await provisionDevice(
    { edPriv: session.keys.edPriv, edPub: session.keys.edPub },
    { scope: linkedDeviceScope(session.userId), ttlSec: LINKED_DEVICE_TTL_SEC },
  );
  // Make the new device a recipient of every keyring this user OWNS, so it can
  // decrypt those spaces immediately. A keyring write is `space:owner`-gated, so
  // we can only grant OWNED spaces — those absent from the member-cap map (joined
  // spaces). Joined spaces stay locked until their owner re-invites this device.
  const { spaces, caps } = await readSpaces(session.accountClient, session.userId);
  for (const space of spaces) {
    if (caps[space.id]) continue; // joined (has a member cap) — not ours to grant
    try {
      await addDeviceToSpaceKeyring(session, space.id, { kemPub: deviceKeys.kemPub, userId: session.userId });
    } catch (err) {
      // Best-effort per space — a single keyring failure must not abort pairing.
      console.log('[pairing] keyring grant failed', { spaceId: space.id, error: String((err as Error)?.message ?? err) });
    }
  }
  const blob = JSON.stringify({ v: 1, keys: deviceKeys, bundle });
  const sealed = await sealWithPassphrase(pin, new TextEncoder().encode(blob));
  const nonce = randomNonce();
  console.log('[pairing] startDevicePairing pushing', { base: SYNC_BASE, namespace: SYNC_NAMESPACE, nonce });
  await anonClient().push(`/push/_pairing/${nonce}`, sealed as unknown as Record<string, unknown>, null);
  console.log('[pairing] startDevicePairing push OK', { nonce });
  // Carry the root pubkey out-of-band in the QR so the new device can pin the
  // bundle to it (defence in depth on top of the PIN seal).
  return `${PAIR_PREFIX}${nonce}.${session.keys.edPub}`;
}

export interface PairResult {
  userId: string;
  fingerprint: string;
  /** The freshly-provisioned device keypair (this device's own keys). */
  deviceKeys: DeviceKeys;
  /** The root-signed cap-cert delegating scope to {@link deviceKeys} — what the
   *  paired device presents instead of a self-minted cap. */
  capCert: CapCert;
}

/** New device: fetch the sealed blob by nonce, open with PIN, validate the bundle. */
export async function completeDevicePairing(payload: string, pin: string): Promise<PairResult> {
  const body = (payload.startsWith(PAIR_PREFIX) ? payload.slice(PAIR_PREFIX.length) : payload).trim();
  const [nonce, expectedRootEdPub] = body.split('.');
  console.log('[pairing] completeDevicePairing pulling', { base: SYNC_BASE, namespace: SYNC_NAMESPACE, nonce, expectedRootEdPub });
  const res = await anonClient()
    .pull(`/pull/_pairing/${nonce}`)
    .catch((e) => {
      console.log('[pairing] pull threw', { nonce, error: String((e as Error)?.message ?? e) });
      return null;
    });
  const sealed = res?.data as Record<string, unknown> | undefined;
  console.log('[pairing] pull result', { nonce, hasRes: !!res, hasData: !!sealed, sealedV: sealed?.v });
  if (!sealed || !sealed.v) throw new Error('Pairing code not found or expired.');
  let inner: Uint8Array;
  try {
    inner = await openWithPassphrase(pin, sealed as never);
  } catch {
    throw new Error('Wrong PIN or corrupted pairing code.');
  }
  const blob = JSON.parse(new TextDecoder().decode(inner)) as { keys: unknown; bundle: unknown };
  // Pin the bundle to the QR-supplied root pubkey: rejects a bundle minted by a
  // different root even if the PIN seal were somehow opened by the wrong party.
  const opts = (expectedRootEdPub ? { expectedRootEdPub } : {}) as Parameters<typeof installPairingBundle>[2];
  const installed = await installPairingBundle(
    blob.bundle as Parameters<typeof installPairingBundle>[0],
    blob.keys as Parameters<typeof installPairingBundle>[1],
    opts,
  );
  const userId = installed.credentials.userId;
  return {
    userId,
    fingerprint: fingerprintFromUserId(userId),
    deviceKeys: installed.credentials.device,
    capCert: installed.credentials.capCert,
  };
}
