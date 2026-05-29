import { contextBridge, ipcRenderer } from 'electron';

// Version is passed from the main process via `additionalArguments` because
// `process.env.npm_package_version` is unreliable under sandbox:true.
const versionArg = process.argv.find((a) => a.startsWith('--app-version='));

// Additive bridge. The mobile app does not (and must not be required to) consume
// window.octochat — it is here for desktop-only features. Each method wraps a
// single named IPC channel; never expose ipcRenderer or node primitives directly.
//
// Future enhancement: a narrow async secure-storage bridge (ipcRenderer.invoke
// → safeStorage) mirroring native expo-secure-store.
contextBridge.exposeInMainWorld('octochat', {
  version: versionArg ? versionArg.split('=')[1] : '1.0.0',
  platform: process.platform,
  isElectron: true,
  // Bring the window forward (e.g. when a notification toast is clicked).
  focusWindow: () => ipcRenderer.invoke('octochat:focus-window'),
  // Reflect the unread total on the dock / taskbar icon (macOS/Linux numeric).
  setBadgeCount: (n: number) => ipcRenderer.invoke('octochat:set-badge', n),
  // Paint a custom colored taskbar overlay badge on Windows. `png` is a PNG data
  // URL (red circle + count) or null to clear; `description` is the a11y label.
  setOverlayBadge: (png: string | null, description: string) =>
    ipcRenderer.invoke('octochat:set-overlay-badge', png, description),
  // Subscribe to OTA update-ready events. The callback receives the new version
  // string; call relaunch() to apply it. Wires one listener — call once at app
  // startup.
  onUpdateReady: (cb: (version: string) => void) =>
    ipcRenderer.on('octochat:update-ready', (_event, version: string) => cb(version)),
  // Pull the already-staged update version on mount, in case the check finished
  // before onUpdateReady was wired (the push above isn't buffered). Null if none.
  getPendingUpdate: () =>
    ipcRenderer.invoke('octochat:get-pending-update') as Promise<string | null>,
  // Run the OTA update check on demand (in-app "Check for updates" button).
  // Resolves to the outcome: 'updated' | 'current' | 'error' | 'unavailable'.
  checkForUpdates: () =>
    ipcRenderer.invoke('octochat:check-for-updates') as Promise<
      'updated' | 'current' | 'error' | 'unavailable'
    >,
  // Relaunch the app to apply a staged OTA bundle.
  relaunch: () => ipcRenderer.invoke('octochat:relaunch'),
});
