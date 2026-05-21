import { protocol, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { APP_SCHEME } from './constants';

// Explicit MIME map: `protocol.handle` does not infer content types, and
// Chromium silently rejects @font-face / modules served with the wrong type.
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Serve the exported Expo web build under the custom `app://` scheme.
 *
 * Real files (e.g. /_expo/static/js/..., /assets/..., /favicon.ico) stream from
 * `distDir`. Any path that is NOT a real file falls back to index.html so that
 * expo-router's History-API routes (e.g. /room/abc) survive a reload.
 */
export function registerAppProtocol(distDir: string): void {
  const root = path.normalize(distDir);
  const indexHtml = path.join(root, 'index.html');

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const candidate = path.normalize(path.join(root, pathname));
    // Guard against path traversal: the resolved path must stay inside distDir.
    const contained = candidate === root || candidate.startsWith(root + path.sep);

    const filePath = contained && isFile(candidate) ? candidate : indexHtml;
    const ext = path.extname(filePath).toLowerCase();

    const res = await net.fetch(pathToFileURL(filePath).toString());
    return new Response(res.body, {
      status: 200,
      headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' },
    });
  });
}
