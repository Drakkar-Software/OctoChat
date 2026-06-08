import { defineConfig } from 'tsup';

// Bundle the headless SDK to ESM with type declarations. Starfish packages stay
// external (the consumer owns the single installed copy — shared platform globals
// + type identity); they are added as the SDK grows.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Optional platform-adapter subpath (`/platform`). Two explicit per-platform
    // entries ARE the branching — tsup does no `.native` resolution; the package
    // `exports` map's `react-native` condition picks the native build. The pure
    // argon2 shim is its own entry (the `./hash-wasm-shim` subpath + bundler alias).
    'platform/index': 'src/platform/index.ts',
    'platform/index.native': 'src/platform/index.native.ts',
    'platform/hash-wasm-shim': 'src/platform/hash-wasm-shim.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  // Keep the optional RN platform peers external or tsup would inline them into the
  // native platform bundle (and pull them into a non-RN consumer's tree).
  external: [
    /^@drakkar\.software\//,
    'expo-secure-store',
    '@react-native-async-storage/async-storage',
    'react-native-quick-crypto',
  ],
});
