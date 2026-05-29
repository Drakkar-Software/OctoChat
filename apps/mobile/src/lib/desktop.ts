/**
 * Thin accessor for the desktop (Electron) bridge exposed on `window.octochat`
 * by `apps/desktop/src/preload.ts`. Web and native have no such global, so every
 * helper feature-detects and no-ops off-desktop — the app must never depend on
 * the bridge being present (the bridge is additive).
 *
 * The renderer is sandboxed and can't focus its own OS window or set the dock /
 * taskbar badge; those go through IPC to the Electron main process.
 */
import { colors } from '../theme';

/** Outcome of an on-demand desktop OTA check (mirror of the main-process type). */
export type DesktopUpdateResult = 'updated' | 'current' | 'error' | 'unavailable';

declare global {
  interface Window {
    octochat?: {
      isElectron?: boolean;
      version?: string;
      platform?: string;
      focusWindow?: () => void;
      setBadgeCount?: (n: number) => void;
      /** Windows-only: paint a colored taskbar overlay badge (PNG data URL), or null to clear. */
      setOverlayBadge?: (png: string | null, description: string) => void;
      /** Subscribe to OTA update-ready events. Call once at startup. */
      onUpdateReady?: (cb: (version: string) => void) => void;
      /** Pull an already-staged update version on mount (push isn't buffered). */
      getPendingUpdate?: () => Promise<string | null>;
      /** Run the OTA check on demand; resolves to the outcome. */
      checkForUpdates?: () => Promise<DesktopUpdateResult>;
      /** Relaunch the app to apply a staged OTA bundle. */
      relaunch?: () => void;
    };
  }
}

export function isDesktop(): boolean {
  return !!globalThis.window?.octochat?.isElectron;
}

/** The Electron app version reported by the desktop bridge. Null off-desktop. */
export function desktopVersion(): string | null {
  return globalThis.window?.octochat?.version ?? null;
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

/**
 * Reflect the unread total on the dock / taskbar icon. No-op off-desktop.
 *
 * macOS (dock) and Linux Unity render a real numeric badge from setBadgeCount —
 * red by default. Windows has no numeric badge (setBadgeCount only draws a plain
 * grey dot), so there we paint our own red circle and hand it to the taskbar
 * overlay-icon API via setOverlayBadge.
 */
export function setDesktopBadge(n: number): void {
  const bridge = globalThis.window?.octochat;
  if (!bridge) return;
  if (bridge.platform === 'win32') {
    bridge.setOverlayBadge?.(n > 0 ? drawBadgePng(n) : null, n > 0 ? `${n} unread` : '');
    return;
  }
  bridge.setBadgeCount?.(n);
}

/**
 * Render a red circular unread badge to a PNG data URL for the Windows taskbar
 * overlay. Counts above 9 collapse to "9+". Drawn at 2× (32px) for HiDPI
 * crispness. Only ever called inside the win32 branch above — i.e. in the
 * Electron renderer, which is Chromium and always has `document`/`canvas`.
 */
function drawBadgePng(n: number): string {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  // Reuse the theme's notification red rather than hardcoding a hex.
  ctx.fillStyle = colors.light.mention;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const label = n > 9 ? '9+' : String(n);
  ctx.fillStyle = colors.light.onAccent;
  ctx.font = `bold ${label.length > 1 ? 16 : 20}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL('image/png');
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
 * Pull the version of an OTA bundle that was already staged before this renderer
 * mounted (the `onDesktopUpdateReady` push is fire-once and unbuffered, so a
 * check that completed during load would otherwise be missed). Null off-desktop
 * and when no update is staged.
 */
export async function getDesktopPendingUpdate(): Promise<string | null> {
  return (await globalThis.window?.octochat?.getPendingUpdate?.()) ?? null;
}

/**
 * Trigger the desktop OTA check on demand (the in-app "Check for updates"
 * button). Resolves to the outcome, or null off-desktop. A returned 'updated'
 * means a bundle was staged — the `onDesktopUpdateReady` push fires in parallel,
 * so the global restart banner surfaces too.
 */
export async function checkDesktopUpdate(): Promise<DesktopUpdateResult | null> {
  const fn = globalThis.window?.octochat?.checkForUpdates;
  return fn ? await fn() : null;
}

/**
 * Relaunch the desktop app to apply a staged OTA bundle. No-op off-desktop.
 * Only call this after `onDesktopUpdateReady` fires.
 */
export function relaunchDesktop(): void {
  globalThis.window?.octochat?.relaunch?.();
}
