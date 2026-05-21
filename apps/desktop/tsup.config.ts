import { defineConfig } from 'tsup';

// Build the Electron main + preload to CommonJS in dist-electron/.
// `electron` is provided by the runtime, never bundled.
export default defineConfig({
  entry: { main: 'src/main.ts', preload: 'src/preload.ts' },
  outDir: 'dist-electron',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  clean: true,
});
