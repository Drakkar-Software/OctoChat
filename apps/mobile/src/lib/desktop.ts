/**
 * Thin accessor for the desktop (Electron) bridge exposed on `window.octochat`
 * by `apps/desktop/src/preload.ts`. Web and native have no such global, so every
 * helper feature-detects and no-ops off-desktop — the app must never depend on
 * the bridge being present (the bridge is additive).
 *
 * The renderer is sandboxed and can't focus its own OS window or set the dock /
 * taskbar badge; those go through IPC to the Electron main process.
 */
declare global {
  interface Window {
    octochat?: {
      isElectron?: boolean;
      version?: string;
      platform?: string;
      focusWindow?: () => void;
      setBadgeCount?: (n: number) => void;
      /** Subscribe to OTA update-ready events. Call once at startup. */
      onUpdateReady?: (cb: (version: string) => void) => void;
      /** Relaunch the app to apply a staged OTA bundle. */
      relaunch?: () => void;
    };
  }
}

export function isDesktop(): boolean {
  return !!globalThis.window?.octochat?.isElectron;
}

/**
 * True only in the macOS desktop build, where the window uses the `hiddenInset`
 * title-bar style and the renderer must reserve a top strip for the traffic
 * lights. `platform` mirrors Electron's `process.platform` (see preload.ts).
 */
export function isMacDesktop(): boolean {
  return isDesktop() && globalThis.window?.octochat?.platform === 'darwin';
}

/** Bring the desktop window to the front (restores if minimized). No-op elsewhere. */
export function focusDesktopWindow(): void {
  globalThis.window?.octochat?.focusWindow?.();
}

/** Reflect the unread total on the dock / taskbar icon. No-op elsewhere. */
export function setDesktopBadge(n: number): void {
  globalThis.window?.octochat?.setBadgeCount?.(n);
}

/**
 * Register a callback that fires when an OTA bundle finishes downloading and is
 * ready to apply on the next relaunch. No-op off-desktop. Call once at app
 * startup (e.g. in the root layout).
 */
export function onDesktopUpdateReady(cb: (version: string) => void): void {
  globalThis.window?.octochat?.onUpdateReady?.(cb);
}

/**
 * Relaunch the desktop app to apply a staged OTA bundle. No-op off-desktop.
 * Only call this after `onDesktopUpdateReady` fires.
 */
export function relaunchDesktop(): void {
  globalThis.window?.octochat?.relaunch?.();
}
