/**
 * Seal a small secret to an X25519 KEM key so it can ride in a plaintext synced doc
 * without exposing it to the server (or to anyone who can read the doc but lacks the
 * recipient's private key).
 *
 * Two recipients, one mechanism:
 *  - {@link sealToSelf}/{@link unsealFromSelf} — sealed to THIS account's OWN key, for
 *    secrets that must sync across the account's devices (PUBLIC-space join
 *    credentials, which embed a bearer secret). Recovered on any device with the same
 *    seed.
 *  - {@link sealToRecipient}/{@link unsealFromRecipient} — sealed to ANOTHER user's
 *    published KEM key, for delivering a secret to that peer through a doc they can
 *    read (the DM-invite carrier — see `dm-inbox.ts`). The recipient trial-unseals.
 *
 * Mechanism: wrap a random AES-256 content key to the recipient's X25519 KEM key via
 * the keyring's single-recipient primitive (`wrapForRecipient`), then AES-256-GCM the
 * payload under that key. The wrap entry is signed by the SEALER's Ed key, so the
 * recipient can authenticate who sealed it (`entry.addedBy`).
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

/** A payload sealed to a KEM key: the wrapped CEK + hex(iv ‖ AES-GCM ct). */
export interface SealedBlob {
  /** The CEK wrapped to the recipient's KEM key (single-recipient, sealer-signed). */
  entry: WrappedKeyEntry;
  /** hex( iv(12) ‖ AES-256-GCM(cek, iv, utf8(plaintext)) ). */
  ct: string;
}

// All seals live at a fixed pseudo-epoch (there is no rotating keyring here — each
// blob wraps to a single static recipient key). `wrapForRecipient` and
// `verifyEntrySignature` must agree on it.
const SELF_EPOCH = 0;

const subtle = () => globalThis.crypto.subtle;

/** Wrap a fresh CEK to `recipientKemPub` (signed by the sealer) + AES-GCM the payload
 *  under it. The shared core of {@link sealToSelf} and {@link sealToRecipient}. */
async function seal(session: Session, recipientKemPub: string, plaintext: string): Promise<SealedBlob> {
  const cek = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const entry = await wrapForRecipient(cek, recipientKemPub, {
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

/** Unwrap a blob's CEK with THIS account's KEM private key + AES-GCM open it. Throws if
 *  the blob wasn't sealed to this key (wrong recipient) or decryption fails. */
async function open(session: Session, blob: SealedBlob): Promise<string> {
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

/** Seal `plaintext` so only this account (its seed) can open it. */
export function sealToSelf(session: Session, plaintext: string): Promise<SealedBlob> {
  return seal(session, session.keys.kemPub, plaintext);
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
  return open(session, blob);
}

/**
 * Seal `plaintext` to ANOTHER user's published KEM key, signed by this session — only
 * the holder of `recipientKemPub`'s private key can open it. Used to deliver a DM
 * invite to a peer through a doc they can read (the carrier in `dm-inbox.ts`).
 */
export function sealToRecipient(session: Session, recipientKemPub: string, plaintext: string): Promise<SealedBlob> {
  return seal(session, recipientKemPub, plaintext);
}

/**
 * Open a {@link SealedBlob} sealed to THIS account by some (arbitrary) sender. Verifies
 * the wrap entry's signature so `entry.addedBy` is an authentic claim of who sealed it
 * (the caller cross-checks it against the delivered cap's issuer), but does NOT pin the
 * sender — any peer may seal to us. Throws when the blob was sealed to a different key
 * (wrong recipient) — that throw is exactly what lets a reader TRIAL-unseal a shared
 * carrier and skip the elements meant for someone else.
 */
export async function unsealFromRecipient(session: Session, blob: SealedBlob): Promise<string> {
  if (!(await verifyEntrySignature(blob.entry, SELF_EPOCH))) throw new Error('sealed blob signature invalid');
  return open(session, blob);
}
