/**
 * Optional platform-adapter barrel (NATIVE) for `@drakkar.software/octochat-sdk/platform`.
 *
 * Mirrors `index.ts`'s symbol surface with React Native implementations:
 * AsyncStorage kv, expo-secure-store vault, a passkey stub (native uses OS biometrics,
 * not WebAuthn), and react-native-quick-crypto install. Selected by Metro's
 * `react-native` export condition / `.native` resolution.
 */
export * from './kv.native';
export * from './storage.native';
export * from './passkey.native';
export * from './platform.native';
