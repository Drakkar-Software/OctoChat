import { defineConfig } from 'tsup';

// Bundle the UI kit to ESM with type declarations for non-RN / published consumers.
// The monorepo app resolves `@octochat/ui` from SOURCE via the package `exports`
// map's `source`/`react-native` conditions (Metro watches the workspace root), so
// this build is only needed for the `import`/`types` conditions.
//
// React / React Native / @expo/ui stay external — the consumer owns the single
// installed copy (shared runtime + type identity), and @expo/ui must never be
// inlined into a non-native consumer's tree.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'components/index': 'src/components/index.ts',
    'theme/index': 'src/theme/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', 'react-native', /^@expo\/ui/],
});
