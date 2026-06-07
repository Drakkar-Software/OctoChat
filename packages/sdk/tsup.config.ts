import { defineConfig } from 'tsup';

// Bundle the headless SDK to ESM with type declarations. Starfish packages stay
// external (the consumer owns the single installed copy — shared platform globals
// + type identity); they are added as the SDK grows.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: [/^@drakkar\.software\//],
});
