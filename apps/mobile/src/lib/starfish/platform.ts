/**
 * Platform crypto setup. Web (and Node) expose WebCrypto on globalThis, so this
 * is a no-op. The native variant (platform.native.ts) installs the
 * react-native-quick-crypto polyfill. Import for its side effect before any
 * other starfish call.
 */
export function configureStarfishPlatform(): void {
  // no-op on web
}
