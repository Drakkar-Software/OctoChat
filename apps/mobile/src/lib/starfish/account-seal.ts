/**
 * Seal small secrets to THIS account's own key, so they can ride in the account's
 * synced — but plaintext — `_spaces` doc and be recovered on any device with the same
 * seed, without exposing them to the server or to anyone who can read the doc.
 *
 * Used for PUBLIC-space join credentials. Unlike a private member cap (useless without
 * the member's own private key, so safe to store in the clear — see
 * `addJoinedSpaceWithCap`), a public-join credential embeds a bearer secret (the
 * link's ephemeral private key), so it is sealed here before it ever touches the doc.
 *
 * Mechanism: wrap a random AES-256 content key to the account's own X25519 KEM key via
 * the keyring's single-recipient primitive (`wrapForRecipient`), then AES-256-GCM the
 * payload under that key. Self-recipient == self-adder; only the seed can unwrap.
 */
import {
  bytesToHex,
  hexToBytes,
  unwrapFromEntry,
  verifyEntrySignature,
  wrapForRecipient,
} from '@drakkar.software/starfish-keyring';
import type { WrappedKeyEntry } from '@drakkar.software/starfish-keyring';

import type { Session } from './identity';

/** A payload sealed to the account key: the wrapped CEK + hex(iv ‖ AES-GCM ct). */
export interface SealedBlob {
  /** The CEK wrapped to the account's own KEM key (single-recipient, self-signed). */
  entry: WrappedKeyEntry;
  /** hex( iv(12) ‖ AES-256-GCM(cek, iv, utf8(plaintext)) ). */
  ct: string;
}

// Self-seal lives at a fixed pseudo-epoch (there is no rotating keyring here — the
// recipient is always the account's own current KEM key). `wrapForRecipient` and
// `verifyEntrySignature` must agree on it.
const SELF_EPOCH = 0;

const subtle = () => globalThis.crypto.subtle;

/** Seal `plaintext` so only this account (its seed) can open it. */
export async function sealToSelf(session: Session, plaintext: string): Promise<SealedBlob> {
  const cek = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const entry = await wrapForRecipient(cek, session.keys.kemPub, {
    adderEdPrivHex: session.keys.edPriv,
    adderEdPubHex: session.keys.edPub,
    addedAt: Math.floor(Date.now() / 1000),
    epoch: SELF_EPOCH,
  });
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await subtle().importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ctBuf = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const packed = new Uint8Array(iv.length + ctBuf.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ctBuf), iv.length);
  return { entry, ct: bytesToHex(packed) };
}

/**
 * Open a {@link SealedBlob} sealed by {@link sealToSelf} for this account. Throws if it
 * wasn't sealed to / signed by this account, or if decryption fails.
 */
export async function unsealFromSelf(session: Session, blob: SealedBlob): Promise<string> {
  // Defense-in-depth: a hostile server could substitute an entry that wraps an
  // attacker-chosen CEK to our (public) KEM key and self-signs it. Such a forged
  // credential would merely fail to authenticate downstream (no secret leaks), but
  // reject it up front anyway — only our own self-seal is trusted.
  if (blob.entry.addedBy !== session.keys.edPub) throw new Error('sealed blob not self-signed');
  if (!(await verifyEntrySignature(blob.entry, SELF_EPOCH))) throw new Error('sealed blob signature invalid');
  const cek = await unwrapFromEntry(blob.entry, session.keys.kemPriv);
  const packed = hexToBytes(blob.ct);
  // Fresh ArrayBuffer-backed copies — a Uint8Array view over the keyring's hex bytes is
  // typed `ArrayBufferLike` and won't satisfy WebCrypto's `BufferSource`.
  const iv = new Uint8Array(packed.subarray(0, 12));
  const ctBytes = new Uint8Array(packed.subarray(12));
  const key = await subtle().importKey('raw', new Uint8Array(cek), { name: 'AES-GCM' }, false, ['decrypt']);
  const out = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ctBytes);
  return new TextDecoder().decode(out);
}
