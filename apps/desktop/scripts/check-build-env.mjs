/**
 * Preflight guard for the desktop build.
 *
 * The renderer's Starfish server URL is baked into the web bundle at EXPORT time
 * — `EXPO_PUBLIC_*` vars are inlined by `expo export`, never read at runtime. A
 * build that omits them silently falls back to the dev default
 * `http://localhost:8787`, which is unreachable for a distributed desktop app:
 * the packaged client still unlocks the seed (local crypto) but every sync call
 * fails and no rooms load. Fail the build instead of shipping that.
 *
 * Required before `pnpm package` / `pnpm export` (cross-env keeps it cross-platform):
 *   EXPO_PUBLIC_STARFISH_URL=https://dev-sync.drakkar.software/sync
 *   EXPO_PUBLIC_STARFISH_NAMESPACE=octospaces
 */
const REQUIRED = ['EXPO_PUBLIC_STARFISH_URL', 'EXPO_PUBLIC_STARFISH_NAMESPACE'];

const missing = REQUIRED.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error('\n✗ Desktop build aborted — required build-time variable(s) unset:');
  for (const key of missing) console.error(`    ${key}`);
  console.error(
    '\nThese bake the sync server into the web bundle. Without them the build falls',
  );
  console.error(
    'back to http://localhost:8787 and ships an app that cannot reach the server.',
  );
  console.error('Set them before packaging:\n');
  console.error('  cross-env EXPO_PUBLIC_STARFISH_URL=https://dev-sync.drakkar.software/sync \\');
  console.error('            EXPO_PUBLIC_STARFISH_NAMESPACE=octospaces \\');
  console.error('            pnpm --filter @octochat/desktop package\n');
  process.exit(1);
}

// Namespace guard: for non-localhost deploys, only 'octospaces' is valid.
// The 'octochat' namespace was deleted in the 2026-06-15 consolidation — any other
// value baked into the bundle results in 404s on every sync call.
const _ns = process.env.EXPO_PUBLIC_STARFISH_NAMESPACE?.trim() ?? '';
const _url = process.env.EXPO_PUBLIC_STARFISH_URL?.trim() ?? '';
if (_url && !_url.includes('localhost') && _ns !== 'octospaces') {
  console.error(`\n✗ Desktop build aborted — deploying to "${_url}" but namespace is "${_ns || '(empty)'}".`);
  console.error('The deployed server only accepts the "octospaces" namespace (consolidated 2026-06-15).');
  console.error('Set EXPO_PUBLIC_STARFISH_NAMESPACE=octospaces before packaging.\n');
  process.exit(1);
}

console.log(
  `✓ Desktop build env OK — Starfish ${process.env.EXPO_PUBLIC_STARFISH_URL} (namespace: ${process.env.EXPO_PUBLIC_STARFISH_NAMESPACE})`,
);
