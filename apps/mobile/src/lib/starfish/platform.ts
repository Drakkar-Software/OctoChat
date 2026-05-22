/**
 * Platform crypto setup. Web (and Node) expose WebCrypto on globalThis, so the
 * crypto provider needs no configuration; the native variant
 * (platform.native.ts) installs react-native-quick-crypto via its install().
 * Call before any other starfish call.
 */
import { configurePlatform } from '@drakkar.software/starfish-protocol';

import { starfishBase64 } from './base64';

export function configureStarfishPlatform(): void {
  // The SDK's default base64 encoder spreads the whole byte array into one call
  // (`btoa(String.fromCharCode(...data))`) and overflows the stack on large
  // blobs; register a chunked provider so attachment uploads scale.
  configurePlatform({ base64: starfishBase64 });
}
