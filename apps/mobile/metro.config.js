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
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'hash-wasm') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, 'src/lib/starfish/hash-wasm-shim.ts'),
    };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
