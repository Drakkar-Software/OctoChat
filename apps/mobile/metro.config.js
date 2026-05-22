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

module.exports = config;
