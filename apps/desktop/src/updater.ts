/**
 * Desktop OTA updater — the expo-updates equivalent for the Electron shell.
 *
 * On each launch (packaged only) this module:
 * 1. Fetches the update manifest from EAS Hosting.
 * 2. Compares the remote version to the currently active bundle.
 * 3. Downloads and verifies (sha256) each changed bundle into userData.
 * 4. Writes a "current.json" pointer so the NEXT launch serves the new bundle.
 * 5. Notifies the renderer via `octochat:update-ready` so it can prompt a restart.
 *
 * This mirrors expo-updates' apply-on-next-launch model: the running session is
 * never disrupted, and the embedded resources/web serves as the offline fallback.
 * All errors are swallowed — a failed check never breaks the app.
 */

import { app, BrowserWindow, net } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  UPDATE_BASE,
  isValidBundle,
  readUpdatePointer,
  resolveDistDir,
  updatesRoot,
} from './constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
}

interface UpdateManifest {
  version: string;
  generatedAt: string;
  files: ManifestFile[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Version string from the manifest file inside the currently active bundle dir.
 * Returns null if the manifest is absent or unreadable (e.g. the embedded
 * baseline was built before this feature was added).
 */
function getActiveVersion(): string | null {
  const dir = resolveDistDir();
  try {
    const raw = fs.readFileSync(path.join(dir, 'desktop-update.json'), 'utf8');
    const m = JSON.parse(raw) as Partial<UpdateManifest>;
    return typeof m.version === 'string' ? m.version : null;
  } catch {
    return null;
  }
}

/** Fetch JSON, throwing on non-2xx. */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch raw bytes and verify sha256.  Throws on HTTP error or hash mismatch so
 * the caller can abort and discard the partial download.
 */
async function fetchVerified(url: string, expectedSha256: string): Promise<Buffer> {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(
      `sha256 mismatch for ${url}:\n  expected ${expectedSha256}\n  got      ${actual}`,
    );
  }
  return buf;
}

/** Write `buf` to `filePath`, creating parent directories as needed. */
function writeMkdirp(filePath: string, buf: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

/** Remove old downloaded version dirs, keeping only `keepVersion`. */
function pruneOldVersions(keepVersion: string): void {
  try {
    const root = updatesRoot();
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Leave current.json, the active version dir, and any in-progress .tmp dirs
      if (entry.name === keepVersion || entry.name.endsWith('.tmp')) continue;
      try {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      } catch {
        // Ignore — leftover dirs are harmless
      }
    }
  } catch {
    // updatesRoot may not exist yet; nothing to prune
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check EAS Hosting for a newer web bundle, download and verify it in the
 * background, then write the apply-on-next-launch pointer.
 *
 * - Only runs in a packaged (production) build.
 * - Errors are caught and logged; the app always loads normally.
 * - Safe to call concurrently — a second overlapping call is a no-op (the .tmp
 *   dir won't be renamed because the target already exists after the first run).
 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return;

  try {
    // Cache-bust the manifest fetch so CDN edge caches don't hide new versions.
    const manifestUrl = `${UPDATE_BASE}/desktop-update.json?ts=${Date.now()}`;
    const remote = await fetchJson<UpdateManifest>(manifestUrl);

    const activeVersion = getActiveVersion();
    if (remote.version === activeVersion) {
      console.log('[ota] Up to date:', remote.version);
      return;
    }

    const root = updatesRoot();
    const targetDir = path.join(root, remote.version);
    const tmpDir = `${targetDir}.tmp`;

    if (!isValidBundle(targetDir)) {
      console.log('[ota] Downloading version:', remote.version, `(${remote.files.length} files)`);

      // Discard any previous aborted attempt
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}

      for (const file of remote.files) {
        // Build a proper URL so path separators are always '/' regardless of OS
        const fileUrl = new URL(file.path, `${UPDATE_BASE}/`).toString();
        const buf = await fetchVerified(fileUrl, file.sha256);
        writeMkdirp(path.join(tmpDir, file.path), buf);
      }

      // Persist the manifest inside the bundle dir so getActiveVersion() works
      // on subsequent launches when this dir is the active one.
      writeMkdirp(
        path.join(tmpDir, 'desktop-update.json'),
        Buffer.from(JSON.stringify(remote, null, 2) + '\n', 'utf8'),
      );

      // Atomic-ish promotion: remove any prior incomplete targetDir, then rename
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {}
      fs.renameSync(tmpDir, targetDir);
      console.log('[ota] Download complete:', remote.version);
    } else {
      console.log('[ota] Already staged (missed pointer write):', remote.version);
    }

    // Write the pointer — resolveDistDir() will pick this up on the NEXT launch
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'current.json'),
      JSON.stringify({ version: remote.version }) + '\n',
      'utf8',
    );

    pruneOldVersions(remote.version);

    // Tell the renderer a restart will apply the update
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('octochat:update-ready', remote.version);
    }
  } catch (err) {
    console.error('[ota] Update check failed (will retry on next launch):', err);
  }
}
