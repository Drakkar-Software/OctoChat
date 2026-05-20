/**
 * Native crypto setup. The polyfill patches `globalThis.crypto` (incl.
 * `getRandomValues` and `subtle`), which @noble/curves and the keyring/identity
 * packages rely on. Imported for its side effect from the root layout BEFORE
 * any starfish call. Requires a custom dev build (not Expo Go) + New Architecture.
 */
import 'react-native-quick-crypto/polyfill';

export function configureStarfishPlatform(): void {
  // The polyfill import above installs globalThis.crypto; nothing else to do.
}
