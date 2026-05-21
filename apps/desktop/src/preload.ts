import { contextBridge } from 'electron';

// Version is passed from the main process via `additionalArguments` because
// `process.env.npm_package_version` is unreliable under sandbox:true.
const versionArg = process.argv.find((a) => a.startsWith('--app-version='));

// Additive, read-only bridge. The mobile app does not (and must not be required
// to) consume window.octochat — it is here for future desktop-only features.
//
// Future enhancement: a narrow async secure-storage bridge (ipcRenderer.invoke
// → safeStorage) mirroring native expo-secure-store. Never expose ipcRenderer
// or node primitives directly.
contextBridge.exposeInMainWorld('octochat', {
  version: versionArg ? versionArg.split('=')[1] : '1.0.0',
  platform: process.platform,
  isElectron: true,
});
