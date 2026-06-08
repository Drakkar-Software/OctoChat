/**
 * Native crypto setup. `install()` patches `globalThis.crypto` (incl.
 * `getRandomValues` and `subtle`) and `globalThis.Buffer`, which @noble/curves
 * and the keyring/identity packages rely on. Runs at module load (the root
 * layout imports this module) BEFORE any starfish call. Requires a custom dev
 * build (not Expo Go) + New Architecture.
 */
import { install } from 'react-native-quick-crypto';
import { configurePlatform } from '@drakkar.software/starfish-protocol';

import { starfishBase64 } from '../starfish/base64';

// quick-crypto v1 (Nitro) dropped the `react-native-quick-crypto/polyfill`
// side-effect entry point; call install() instead to patch globalThis.crypto.
install();

export function configureStarfishPlatform(): void {
  // The install() call above installs globalThis.crypto. Hermes ships no
  // `btoa`/`atob`, so the SDK's default base64 would throw; register our chunked
  // provider (which has a pure fallback) so sealing/persisting blobs works.
  configurePlatform({ base64: starfishBase64 });
}
