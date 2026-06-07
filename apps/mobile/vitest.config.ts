import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The `@/*` path alias (tsconfig `paths`) is resolved by Metro/tsc at build time;
// vitest needs it spelled out so value imports like `@/lib/starfish/stream-bots`
// resolve under node. Type-only `@/` imports are stripped by the transform and
// never reach here.
// The `@drakkar.software/octochat-sdk` workspace package is aliased to its SOURCE
// so app tests run against the SDK without a build step in the dev loop.
export default defineConfig({
  resolve: {
    alias: {
      '@drakkar.software/octochat-sdk': fileURLToPath(
        new URL('../../packages/sdk/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
