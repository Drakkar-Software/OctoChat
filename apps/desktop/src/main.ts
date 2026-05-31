import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import {
  APP_NAME,
  APP_ORIGIN,
  APP_SCHEME,
  DEV_URL,
  isDev,
  resolveDistDir,
} from './constants';
import { registerAppProtocol } from './protocol';
import { checkForUpdates, getPendingUpdateVersion } from './updater';

// Must run BEFORE app is ready and at top level. `standard` gives a real origin
// (relative URLs + reliable localStorage), `secure` enables secure-context APIs
// (navigator.clipboard, crypto), and supportFetchAPI/corsEnabled let the
// renderer fetch the sync server (http://localhost:8787) cross-origin.
// Display name for the menu bar / About / Quit items. Without this, an
// unpackaged run (`electron .`) shows the package name "@octochat/desktop".
app.setName(APP_NAME);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

// Closing the window HIDES it instead of destroying it, so the renderer — and
// with it the live SSE stream and the in-memory unlock that decrypts message
// previews — keeps running and background notifications keep firing (the same
// real-content path the app uses while focused). A tray icon brings it back;
// a real quit goes through the tray's Quit or the app/Cmd-Q menu, which sets
// `isQuitting` first so the close handler lets the window go.
let isQuitting = false;
let tray: Tray | null = null;

/** Restore + focus the main window, recreating it only if it was fully closed. */
function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    createWindow();
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0b151c',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Keep timers/JS running at full rate when the window is hidden in the
      // tray, so the SSE stream and notification path don't get throttled.
      backgroundThrottling: false,
      // Let the notification chime (Web Audio, see mobile `notification-sound.ts`)
      // play even with no recent user gesture — a toast fires after the window
      // has sat idle in the tray, when Chromium's default policy would otherwise
      // keep a resumed AudioContext silent.
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
  });

  win.once('ready-to-show', () => win.show());

  // Hide to the tray on close (see `isQuitting` note above) rather than tearing
  // down the renderer; a genuine quit has set `isQuitting` and falls through.
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  // Open http(s) links (e.g. external URLs) in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block full-page navigations away from the app; route http(s) to the browser.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev
      ? url.startsWith(DEV_URL)
      : url.startsWith(`${APP_SCHEME}://`);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadURL(APP_ORIGIN);
  }
}

// Renderer → main bridge for the few things the sandboxed renderer can't do
// itself. Channels mirror the methods exposed in preload.ts.
function registerIpc(): void {
  // Bring the window forward (notification toast clicked). Same restore/focus
  // pattern as the single-instance handler below, plus show() in case it's hidden.
  ipcMain.handle('octochat:focus-window', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  // Reflect the unread total on the dock (macOS) / taskbar (Linux Unity) icon.
  // The renderer routes Windows to set-overlay-badge below instead, because
  // Windows has no numeric badge — setBadgeCount only draws a default grey dot.
  ipcMain.handle('octochat:set-badge', (_event, count: unknown) => {
    app.setBadgeCount(typeof count === 'number' && count > 0 ? count : 0);
  });

  // Windows-only colored taskbar badge. `png` is a renderer-rendered PNG data
  // URL (a red circle + count, themed in the app) or null to clear; the taskbar
  // overlay-icon API gives full color control that setBadgeCount's grey dot does
  // not. No-op on macOS/Linux, which use the numeric badge above.
  ipcMain.handle('octochat:set-overlay-badge', (_event, png: unknown, description: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const image =
      typeof png === 'string' && png.length > 0 ? nativeImage.createFromDataURL(png) : null;
    win.setOverlayIcon(image, typeof description === 'string' ? description : '');
  });

  // Let a freshly-mounted renderer learn about an update that was staged before
  // it registered its `octochat:update-ready` listener (the push isn't buffered).
  ipcMain.handle('octochat:get-pending-update', () => getPendingUpdateVersion());

  // Run the OTA check on demand (the in-app "Check for updates" button). The
  // renderer can't run the updater itself — expo-updates is disabled there — so
  // it invokes this and gets back the outcome (downloaded / current / error).
  ipcMain.handle('octochat:check-for-updates', () => checkForUpdates());

  // Relaunch the app to apply a staged OTA bundle (called from the renderer
  // when the user accepts the "update ready" prompt).
  ipcMain.handle('octochat:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}

// Tray icon: the way back to a window hidden on close, plus an explicit Quit.
// The icon ships next to main.js (tsup `publicDir`) so it resolves in dev and
// packaged alike; resized small for the menu bar / system tray.
function createTray(): void {
  const image = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  const icon = image.isEmpty() ? image : image.resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show ${APP_NAME}`, click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  // Left-click the tray icon also reopens the window (Windows/Linux convention).
  tray.on('click', showMainWindow);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[])
      : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? ([
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    // Only show update controls in production — dev already has live reload.
    ...(!isDev
      ? ([
          {
            label: 'Help',
            submenu: [
              {
                label: 'Check for Updates',
                click: () => void checkForUpdates(),
              },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single-instance lock: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    // Identifies the app to Windows so notification toasts show the right name
    // and icon (no-op on macOS/Linux). Must match electron-builder.yml `appId`.
    app.setAppUserModelId('software.drakkar.octochat');
    if (!isDev) registerAppProtocol(resolveDistDir());
    registerIpc();
    buildMenu();
    createWindow();
    createTray();
    // Check for a newer web bundle in the background after the window is up.
    // Errors are caught inside checkForUpdates — offline launch is always safe.
    if (!isDev) void checkForUpdates();

    // Dock click (macOS) / relaunch: reveal the window the tray is holding hidden,
    // not just the empty-windows case.
    app.on('activate', showMainWindow);
  });

  // A real quit (Cmd-Q, app menu, tray Quit, OS shutdown) must let the window's
  // close handler through instead of hiding it.
  app.on('before-quit', () => {
    isQuitting = true;
  });

  // With hide-to-tray the window is rarely destroyed, so this seldom fires; keep
  // it gated on `isQuitting` so a stray all-closed during teardown still exits and
  // a hide never quits the app on Windows/Linux.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) app.quit();
  });
}
