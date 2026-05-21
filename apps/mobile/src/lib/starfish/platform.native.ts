/**
 * Native crypto setup. The polyfill patches `globalThis.crypto` (incl.
 * `getRandomValues` and `subtle`), which @noble/curves and the keyring/identity
 * packages rely on. Imported for its side effect from the root layout BEFORE
 * any starfish call. Requires a custom dev build (not Expo Go) + New Architecture.
 */
import 'react-native-quick-crypto/polyfill';
import { configurePlatform } from '@drakkar.software/starfish-protocol';

import { starfishBase64 } from './base64';

export function configureStarfishPlatform(): void {
  // The polyfill import above installs globalThis.crypto. Hermes ships no
  // `btoa`/`atob`, so the SDK's default base64 would throw; register our chunked
  // provider (which has a pure fallback) so sealing/persisting blobs works.
  configurePlatform({ base64: starfishBase64 });
}
