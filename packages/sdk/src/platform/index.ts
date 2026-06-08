/**
 * Optional platform-adapter barrel (WEB) for `@drakkar.software/octochat-sdk/platform`.
 *
 * The SDK CORE (`@drakkar.software/octochat-sdk`) stays platform-agnostic and
 * dependency-free; THIS subpath is the opt-in layer a host wires at boot: the kv store
 * (fed into `configureKv`), the seed vault, WebAuthn passkeys, and the crypto install
 * (`configureStarfishPlatform`). The native build lives in `index.native.ts` and is
 * selected by Metro's `react-native` export condition / `.native` resolution.
 */
export * from './kv';
export * from './storage';
export * from './passkey';
export * from './platform';
