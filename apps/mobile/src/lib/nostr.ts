/**
 * NIP-07 browser-extension login. Web-only: a Nostr extension (nos2x, Alby, …)
 * signs the fixed `SECP256K1_BOOTSTRAP_CHALLENGE` with the user's secp256k1
 * root, and the SDK HKDFs that signature into a Starfish v3 root identity.
 *
 * The secp256k1 private key never leaves the extension; the 64-byte Schnorr
 * signature is private-key-equivalent and is consumed once here.
 *
 * Determinism caveat: BIP-340 permits a deterministic signer (aux_rand = 0),
 * which nos2x and Alby use today. A non-deterministic extension would produce
 * a different signature on each call → a different `userId` → lockout from any
 * caps minted by the previous derivation.
 */
import {
  SECP256K1_BOOTSTRAP_CHALLENGE,
  deriveRootIdentityFromSecp256k1Signature,
  type RootIdentity,
} from '@drakkar.software/starfish-identities';
import { bytesToHex, hexToBytes } from '@drakkar.software/starfish-keyring';

interface NostrProvider {
  getPublicKey: () => Promise<string>;
  signSchnorr?: (hexHash: string) => Promise<string>;
}

function provider(): NostrProvider | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { nostr?: NostrProvider }).nostr;
  return p ?? null;
}

/** True when a NIP-07 extension exposing `signSchnorr` is detected. */
export function hasNostrSignSchnorr(): boolean {
  const p = provider();
  return !!p && typeof p.signSchnorr === 'function';
}

/**
 * Ask the extension for its pubkey + a Schnorr signature over the bootstrap
 * challenge, then derive the v3 root identity. The signature is consumed
 * immediately and dropped — never logged, persisted, or returned.
 */
export async function loginWithNostrExtension(): Promise<RootIdentity> {
  const p = provider();
  if (!p) throw new Error('No Nostr extension detected. Install nos2x or Alby and try again.');
  if (typeof p.signSchnorr !== 'function') {
    throw new Error("This Nostr extension doesn't support signSchnorr. Try nos2x or Alby.");
  }
  const secpPubHex = (await p.getPublicKey()).toLowerCase();
  const sigHex = await p.signSchnorr(bytesToHex(SECP256K1_BOOTSTRAP_CHALLENGE));
  const signature = hexToBytes(sigHex);
  if (signature.length !== 64) {
    throw new Error('Nostr extension returned a malformed Schnorr signature.');
  }
  return deriveRootIdentityFromSecp256k1Signature({ secpPubHex, signature });
}
