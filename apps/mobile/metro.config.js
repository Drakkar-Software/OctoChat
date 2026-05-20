// Metro config for the OctoChat monorepo.
//
// The @drakkar.software/starfish-* packages are consumed via pnpm `link:` from
// the sibling satellite repo (v3 isn't on npm). Metro must therefore watch that
// repo and resolve its node_modules so the linked packages and their transitive
// `workspace:*` deps load. Package `exports` is enabled for the `/zustand` subpath.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const satelliteRoot = path.resolve(workspaceRoot, '../../Drakkar-Software/satellite');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, satelliteRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(satelliteRoot, 'node_modules'),
];

config.resolver.unstable_enablePackageExports = true;

// Never bundle the Node-only server package or its server deps into the app.
config.resolver.blockList = [/\/apps\/server\//, /\/@hono\/node-server\//];

module.exports = config;
