import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The `@/*` path alias (tsconfig `paths`) is resolved by Metro/tsc at build time;
// vitest needs it spelled out so value imports like `@/lib/starfish/stream-bots`
// resolve under node. Type-only `@/` imports are stripped by the transform and
// never reach here.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
