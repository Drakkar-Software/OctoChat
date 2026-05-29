import { defineConfig } from 'tsup';

// Build the Electron main + preload to CommonJS in dist-electron/.
// `electron` is provided by the runtime, never bundled.
export default defineConfig({
  entry: { main: 'src/main.ts', preload: 'src/preload.ts' },
  outDir: 'dist-electron',
  // Static assets (the tray icon) copied next to main.js so they're inside the
  // asar (`files: dist-electron/**/*`) and resolvable via `__dirname` in both
  // dev and packaged runs — `build/` is buildResources only and isn't shipped.
  publicDir: 'assets',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  clean: true,
});
