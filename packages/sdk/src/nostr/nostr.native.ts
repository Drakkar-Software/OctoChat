/**
 * NIP-07 browser-extension login — native stub.
 *
 * The real implementation (`nostr.ts`) requires `window.nostr` (a browser
 * extension API) and transitively pulls `starfish-identities` secp256k1 paths.
 * Neither is available on iOS/Android — this stub keeps dead secp256k1 code out
 * of the native bundle. Metro resolves `./nostr.native` over `./nostr` on native,
 * so the SDK barrel (`index.ts`) picks up this file automatically.
 *
 * On native `hasNostrSignSchnorr()` is always false, so callers that gate on it
 * (`welcome.tsx`) never reach `loginWithNostrExtension`.
 */
import type { RootIdentity } from '@drakkar.software/starfish-identities';

/** Always false on native — no browser extension available. */
export function hasNostrSignSchnorr(): boolean {
  return false;
}

/** Throws — Nostr login is web-only (NIP-07 browser extension). */
export async function loginWithNostrExtension(): Promise<RootIdentity> {
  throw new Error('Nostr login is not available on native.');
}
