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

import { SYNC_BASE, SYNC_NAMESPACE } from './config';
import type { Session } from './identity';
import { fingerprintFromUserId } from './identity';
import { bytesToHex, ownerScope } from './paths';

export const PAIR_PREFIX = 'octochat-pair:';

function anonClient(): StarfishClient {
  // Namespaced like every other client (see makeClient): the `_pairing` rendezvous
  // lives under the same `/v1/octochat` namespace on the deployed server, so the
  // anonymous push/pull must carry it too. Undefined locally (paths unchanged).
  return new StarfishClient({ baseUrl: SYNC_BASE, namespace: SYNC_NAMESPACE });
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
  const { deviceKeys, bundle } = await provisionDevice(
    { edPriv: session.keys.edPriv, edPub: session.keys.edPub },
    { scope: ownerScope() },
  );
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
  return { userId, fingerprint: fingerprintFromUserId(userId) };
}
