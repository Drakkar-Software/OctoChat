/**
 * Native stub for the web-only passkey unlock. Native persists the seed in the
 * OS Keychain/Keystore (expo-secure-store), so there is no WebAuthn path; these
 * mirror `passkey.ts`'s surface and are never invoked on native.
 */
import type { PasskeyEnrollment } from './storage-types';

export function passkeySupported(): boolean {
  return false;
}

export async function passkeyEnrollable(): Promise<boolean> {
  return false;
}

export async function enrollPasskey(_displayName: string): Promise<PasskeyEnrollment> {
  throw new Error('Passkeys are not available on native.');
}

export async function evalPasskey(_credentialId: string, _saltHex: string): Promise<string> {
  throw new Error('Passkeys are not available on native.');
}
