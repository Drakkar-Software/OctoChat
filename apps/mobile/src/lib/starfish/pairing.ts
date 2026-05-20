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

import { SYNC_BASE } from './config';
import type { Session } from './identity';
import { fingerprintFromUserId } from './identity';
import { ownerScope } from './paths';

export const PAIR_PREFIX = 'octochat-pair:';

function anonClient(): StarfishClient {
  return new StarfishClient({ baseUrl: SYNC_BASE });
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  await anonClient().push(`/push/_pairing/${nonce}`, sealed as unknown as Record<string, unknown>, null);
  return `${PAIR_PREFIX}${nonce}`;
}

export interface PairResult {
  userId: string;
  fingerprint: string;
}

/** New device: fetch the sealed blob by nonce, open with PIN, validate the bundle. */
export async function completeDevicePairing(payload: string, pin: string): Promise<PairResult> {
  const nonce = payload.startsWith(PAIR_PREFIX) ? payload.slice(PAIR_PREFIX.length) : payload.trim();
  const res = await anonClient().pull(`/pull/_pairing/${nonce}`).catch(() => null);
  const sealed = res?.data as Record<string, unknown> | undefined;
  if (!sealed || !sealed.v) throw new Error('Pairing code not found or expired.');
  let inner: Uint8Array;
  try {
    inner = await openWithPassphrase(pin, sealed as never);
  } catch {
    throw new Error('Wrong PIN or corrupted pairing code.');
  }
  const blob = JSON.parse(new TextDecoder().decode(inner)) as { keys: unknown; bundle: unknown };
  const installed = await installPairingBundle(
    blob.bundle as Parameters<typeof installPairingBundle>[0],
    blob.keys as Parameters<typeof installPairingBundle>[1],
  );
  const userId = installed.credentials.userId;
  return { userId, fingerprint: fingerprintFromUserId(userId) };
}
