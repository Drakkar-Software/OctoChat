import path from 'node:path';
import { app } from 'electron';

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

/**
 * Where the exported Expo web build (`apps/mobile/dist`) lives at runtime.
 * - packaged: copied to `resources/web` by electron-builder `extraResources`.
 * - dev/unpackaged: `apps/mobile/dist`, relative to compiled `dist-electron/`.
 */
export function resolveDistDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '../../mobile/dist');
}
