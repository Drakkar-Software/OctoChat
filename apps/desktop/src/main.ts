import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  shell,
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
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
  });

  win.once('ready-to-show', () => win.show());

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
  // Windows has no numeric badge — setBadgeCount is a no-op there.
  ipcMain.handle('octochat:set-badge', (_event, count: unknown) => {
    app.setBadgeCount(typeof count === 'number' && count > 0 ? count : 0);
  });

  // Let a freshly-mounted renderer learn about an update that was staged before
  // it registered its `octochat:update-ready` listener (the push isn't buffered).
  ipcMain.handle('octochat:get-pending-update', () => getPendingUpdateVersion());

  // Relaunch the app to apply a staged OTA bundle (called from the renderer
  // when the user accepts the "update ready" prompt).
  ipcMain.handle('octochat:relaunch', () => {
    app.relaunch();
    app.quit();
  });
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
    // Check for a newer web bundle in the background after the window is up.
    // Errors are caught inside checkForUpdates — offline launch is always safe.
    if (!isDev) void checkForUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
