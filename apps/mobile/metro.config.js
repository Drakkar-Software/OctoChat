// Metro config for the OctoChat monorepo.
//
// The @drakkar.software/starfish-* packages are consumed as pinned npm
// dependencies, so Metro only needs to watch the workspace root. Package
// `exports` is enabled for the `/zustand` subpath.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.unstable_enablePackageExports = true;

// Never bundle the Node-only server package or its server deps into the app.
config.resolver.blockList = [/\/apps\/server\//, /\/@hono\/node-server\//];

// Redirect `hash-wasm` (used by starfish-identities for Argon2id) to a pure-JS
// shim on every platform. hash-wasm requires a `WebAssembly` global and throws
// "WebAssembly is not supported in this environment" otherwise — Hermes on
// iOS/Android does not ship WebAssembly any more than the web fallback path
// does, so identity creation fails on native too without the alias. See
// src/lib/starfish/hash-wasm-shim.ts.
const sdkSrc = path.resolve(workspaceRoot, 'packages/sdk/src');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'hash-wasm') {
    // The pure-JS Argon2id shim now lives in the SDK (`src/platform/hash-wasm-shim.ts`);
    // redirect `hash-wasm` (imported deep inside starfish-identities) to it on every
    // platform. A package `exports` map can't remap a third-party specifier, so this
    // alias must live in the consumer's bundler config.
    return {
      type: 'sourceFile',
      filePath: path.resolve(sdkSrc, 'platform/hash-wasm-shim.ts'),
    };
  }
  // Bundle the workspace SDK from SOURCE so the app never depends on a prebuilt
  // `packages/sdk/dist` (gitignored — absent in a fresh CI checkout). Metro
  // already watches the workspace root and transpiles TS, so source resolves
  // directly. The published npm package still ships `dist` via its `exports`.
  if (moduleName === '@drakkar.software/octochat-sdk') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(sdkSrc, 'index.ts'),
    };
  }
  // The optional `/platform` subpath also resolves to SOURCE in dev. A hard filePath
  // return bypasses Metro's automatic `.native.ts` extension resolution, so branch on
  // `platform` to pick the right barrel (the barrel's own relative imports then resolve
  // their `.native` siblings normally).
  if (moduleName === '@drakkar.software/octochat-sdk/platform') {
    const isNative = platform === 'ios' || platform === 'android';
    return {
      type: 'sourceFile',
      filePath: path.resolve(sdkSrc, 'platform', isNative ? 'index.native.ts' : 'index.ts'),
    };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
