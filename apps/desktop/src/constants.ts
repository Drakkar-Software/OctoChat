import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** Display name (menu bar, About/Quit items, dock in dev). Overrides the package
 *  name `@octochat/desktop` that Electron uses by default when unpackaged.
 *  Packaged builds get this from electron-builder's `productName`, but setting it
 *  here makes dev (`electron .`) and prod agree. */
export const APP_NAME = 'OctoChat';

/** Custom privileged scheme that serves the exported Expo web build in prod. */
export const APP_SCHEME = 'app';

/** Origin loaded under the custom scheme: app://octochat/. */
export const APP_ORIGIN = `${APP_SCHEME}://octochat/`;

/** Expo dev server (`expo start --web`) loaded in development. */
export const DEV_URL = 'http://localhost:8081';

/**
 * Dev = unpackaged run or explicit NODE_ENV. Controls dev-server-vs-protocol
 * loading. The renderer *path* is resolved separately via `app.isPackaged`.
 */
export const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── OTA update constants ────────────────────────────────────────────────────

/**
 * EAS Hosting URL where the Expo web export is deployed.
 *
 * Override at build time by setting OCTOCHAT_UPDATE_URL in the tsup environment
 * (add `define: { 'process.env.OCTOCHAT_UPDATE_URL': '"https://…"' }` to
 * tsup.config.ts) or by setting the env var before launching the packaged app.
 *
 * Fill in the default below after the first `pnpm --filter @octochat/desktop
 * deploy:web` run and the EAS Hosting production URL is known.
 */
export const UPDATE_BASE: string =
  (process.env['OCTOCHAT_UPDATE_URL'] as string | undefined) ??
  'https://oc.drakkar.software';

/** Root directory under userData where downloaded bundle versions are stored. */
export function updatesRoot(): string {
  return path.join(app.getPath('userData'), 'updates');
}

export interface UpdatePointer {
  version: string;
}

/**
 * Read the `updates/current.json` pointer from userData.
 * Returns null if the file is absent, unreadable, or has an unexpected shape.
 */
export function readUpdatePointer(): UpdatePointer | null {
  try {
    const raw = fs.readFileSync(path.join(updatesRoot(), 'current.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['version'] === 'string'
    ) {
      return parsed as UpdatePointer;
    }
    return null;
  } catch {
    return null;
  }
}

/** True if `dir` is a usable downloaded bundle (contains an index.html). */
export function isValidBundle(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, 'index.html')).isFile();
  } catch {
    return false;
  }
}

/**
 * Where the exported Expo web build (`apps/mobile/dist`) lives at runtime.
 *
 * Priority (packaged only):
 *   1. userData/updates/<version>/ if a valid pointer + bundle exist (OTA).
 *   2. resources/web — the version embedded in the installer (offline fallback).
 *
 * Dev/unpackaged: always apps/mobile/dist relative to compiled dist-electron/.
 */
export function resolveDistDir(): string {
  if (!app.isPackaged) {
    return path.resolve(__dirname, '../../mobile/dist');
  }

  const pointer = readUpdatePointer();
  if (pointer) {
    const dir = path.join(updatesRoot(), pointer.version);
    if (isValidBundle(dir)) return dir;
  }

  // Embedded baseline (copied from apps/mobile/dist by electron-builder extraResources)
  return path.join(process.resourcesPath, 'web');
}
