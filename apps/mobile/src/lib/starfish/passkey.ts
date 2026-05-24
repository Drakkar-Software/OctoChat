/**
 * WebAuthn passkey unlock (web only) via the PRF / hmac-secret extension.
 *
 * A platform authenticator (Touch ID / Windows Hello / security key) derives a
 * stable 32-byte secret from a stored salt — a high-entropy key that NEVER lives
 * on disk and has no offline brute-force surface. We feed it (as hex) to the same
 * `sealWithPassphrase` used for the PIN, so there is one seal code path.
 *
 * RP ID note: WebAuthn's RP ID is a *registrable domain* (no scheme/port), not an
 * origin. Leaving it undefined lets the browser default to the current domain,
 * which is correct for `localhost` dev and single-domain deploys. Only set it
 * explicitly when serving the app across subdomains.
 */
import { bytesToHex } from './paths';
import type { PasskeyEnrollment } from './storage-types';

const RP_NAME = 'OctoChat';
const PRF_SECRET_LEN = 32;

/**
 * PRF-capable WebAuthn needs the credentials API and a secure context (https or
 * localhost). PRF support itself is authenticator-dependent and only knowable at
 * enrollment (`prf.enabled`), so this is a necessary, not sufficient, check.
 */
export function passkeySupported(): boolean {
  return (
    typeof PublicKeyCredential !== 'undefined' &&
    typeof globalThis.navigator?.credentials?.create === 'function' &&
    globalThis.isSecureContext === true
  );
}

/**
 * Stricter than {@link passkeySupported}: also requires a *platform* authenticator
 * (Touch ID / Face ID / Windows Hello / Android biometric) to be present, so we only
 * OFFER enrollment when the device can satisfy a passkey locally — not merely via a
 * roaming security key or a cross-device QR passkey. Async because the UVPAA probe is.
 *
 * Unlock keeps using the looser {@link passkeySupported}: an already-enrolled
 * credential must stay usable whenever WebAuthn can run (biometrics may be disabled,
 * or the credential may be a security key), and PIN is always available as a fallback.
 */
export async function passkeyEnrollable(): Promise<boolean> {
  if (!passkeySupported()) return false;
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Return ArrayBuffer-backed views: WebAuthn's `BufferSource` fields reject the
// default `Uint8Array<ArrayBufferLike>` (which may be a SharedArrayBuffer).
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Pull the first PRF result (32 bytes) out of a credential's extension results. */
function prfFirst(cred: PublicKeyCredential | null): Uint8Array | null {
  const res = (cred?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } })
    ?.prf?.results?.first;
  return res ? new Uint8Array(res) : null;
}

/**
 * Register a new passkey and obtain its PRF secret. The portable pattern is
 * `create()` to enable PRF, then a `get()` to read the secret — so the user may
 * see TWO authenticator prompts. Some authenticators already return the secret at
 * `create()`, in which case the second prompt is skipped.
 */
export async function enrollPasskey(displayName: string): Promise<PasskeyEnrollment> {
  if (!passkeySupported()) throw new Error('Passkeys are not supported in this browser.');
  const salt = randomBytes(PRF_SECRET_LEN);
  const name = displayName.trim() || 'octochat';

  const created = (await globalThis.navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: RP_NAME },
      user: { id: randomBytes(16), name, displayName: name },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: salt } } } as unknown as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!created) throw new Error('Passkey creation was cancelled.');

  const ext = created.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  if (!ext?.prf?.enabled) {
    throw new Error('This authenticator does not support the PRF extension needed to unlock.');
  }

  const credentialId = bytesToHex(new Uint8Array(created.rawId));
  // Prefer the secret returned at create(); else do one assertion to read it.
  const secret = prfFirst(created) ?? (await evalRaw(credentialId, salt));
  return { credentialId, salt: bytesToHex(salt), secretHex: bytesToHex(secret) };
}

async function evalRaw(credentialId: string, salt: Uint8Array): Promise<Uint8Array> {
  const assertion = (await globalThis.navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: hexToBytes(credentialId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt } } } as unknown as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const secret = prfFirst(assertion);
  if (!secret) throw new Error('Could not derive the passkey secret (PRF unavailable).');
  return secret;
}

/** Unlock: re-derive the PRF secret (hex) for a stored credential id + salt. */
export async function evalPasskey(credentialId: string, saltHex: string): Promise<string> {
  if (!passkeySupported()) throw new Error('Passkeys are not supported in this browser.');
  return bytesToHex(await evalRaw(credentialId, hexToBytes(saltHex)));
}
