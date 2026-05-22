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
    };
  }
}

export function isDesktop(): boolean {
  return !!globalThis.window?.octochat?.isElectron;
}

/** Bring the desktop window to the front (restores if minimized). No-op elsewhere. */
export function focusDesktopWindow(): void {
  globalThis.window?.octochat?.focusWindow?.();
}

/** Reflect the unread total on the dock / taskbar icon. No-op elsewhere. */
export function setDesktopBadge(n: number): void {
  globalThis.window?.octochat?.setBadgeCount?.(n);
}
