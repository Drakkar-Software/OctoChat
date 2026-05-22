/**
 * Generate `desktop-update.json` inside `apps/mobile/dist` after a web export.
 *
 * The manifest lists every file in the exported Expo web build with its sha256
 * hash and byte size, plus a content-based `version` fingerprint (sha256 of the
 * sorted "path:hash" list, truncated to 16 hex chars).  The same file is shipped
 * as both the embedded baseline (via electron-builder extraResources) and on EAS
 * Hosting, so the Electron OTA updater can compare versions and download only
 * when something actually changed.
 *
 * Usage (run from apps/desktop):
 *   node scripts/gen-update-manifest.mjs
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../mobile/dist');
const outFile = path.join(distDir, 'desktop-update.json');

if (!fs.existsSync(distDir)) {
  console.error(`✗ dist dir not found: ${distDir}`);
  console.error('  Run "pnpm --filter @octochat/mobile export:web" first.');
  process.exit(1);
}

/** Walk dir recursively, returning { path (posix-relative), sha256, size }[]. */
function walkDir(dir, base = dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walkDir(full, base));
    } else if (entry.isFile()) {
      // POSIX-style relative path for platform-neutral URLs
      const rel = path.relative(base, full).split(path.sep).join('/');
      // Exclude the manifest itself so the version hash stays stable
      if (rel === 'desktop-update.json') continue;
      const buf = fs.readFileSync(full);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      entries.push({ path: rel, sha256, size: buf.length });
    }
  }
  return entries;
}

const files = walkDir(distDir).sort((a, b) => a.path.localeCompare(b.path));

// Version = sha256 of sorted "path:hash\n" lines, first 16 hex chars.
// Only changes when bundle content changes — identical for embedded and hosted.
const versionInput = files.map((f) => `${f.path}:${f.sha256}`).join('\n');
const version = createHash('sha256').update(versionInput).digest('hex').slice(0, 16);

/** @type {{ version: string; generatedAt: string; files: { path: string; sha256: string; size: number }[] }} */
const manifest = { version, generatedAt: new Date().toISOString(), files };

fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(
  `✓ desktop-update.json written — version=${version}, files=${files.length}`,
);
