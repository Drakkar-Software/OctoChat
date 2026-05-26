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
 * A failed check never breaks the app — it just resolves to 'error' so the in-app
 * button can report it (the boot/menu callers ignore the result).
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
import { parseJsonResponse } from './json';

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

/** Outcome of a manual update check, reported back to the renderer button. */
export type UpdateCheckResult = 'updated' | 'current' | 'error' | 'unavailable';

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

/**
 * Fetch JSON, throwing a descriptive error on non-2xx, a non-JSON content-type,
 * or a parse failure. The content-type guard matters: a static host with an SPA
 * catch-all (e.g. Cloudflare Pages) answers a missing manifest path with HTTP 200
 * and `index.html`, which would otherwise blow up at `res.json()` with an opaque
 * SyntaxError swallowed by the caller. The thrown body prefix lets a packaged
 * build (no devtools) diagnose a bad deploy from the terminal. The guard itself
 * lives in `./json` so it can be unit-tested without electron's `net`.
 */
async function fetchJson<T>(url: string): Promise<T> {
  // Accept: application/json — see fetchVerified for why a non-HTML Accept
  // matters. The manifest is served as JSON, but asking for it explicitly keeps
  // the edge from ever treating the request as a page navigation.
  const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();
  return parseJsonResponse<T>(url, contentType, body);
}

/**
 * Fetch raw bytes and verify sha256.  Throws on HTTP error or hash mismatch so
 * the caller can abort and discard the partial download.
 */
async function fetchVerified(url: string, expectedSha256: string): Promise<Buffer> {
  // Accept: application/octet-stream is load-bearing, not cosmetic.
  //
  // net.fetch's default Accept advertises `text/html`, so a CDN's edge treats the
  // request as a page navigation and may rewrite HTML responses in flight —
  // Cloudflare Web Analytics, for one, injects a `<script src=cloudflareinsights>`
  // beacon into any text/html body. That mutates the bytes (and thus the sha256)
  // of the bundle's only HTML file, index.html, so this verify would fail and the
  // whole update would abort there forever. Asking for octet-stream makes the edge
  // serve the raw asset untouched, keeping the build-time hash valid end-to-end.
  const res = await net.fetch(url, { headers: { Accept: 'application/octet-stream' } });
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

// ─── Pending-update state ───────────────────────────────────────────────────────

/**
 * Version staged for next-launch apply this session, or null if none. Set when
 * `checkForUpdates` finishes staging a bundle. Exposed so the renderer can pull
 * it on mount — `octochat:update-ready` is a fire-once IPC push with no buffering,
 * so a check that completes before React registers its listener would be missed.
 */
let pendingUpdateVersion: string | null = null;

/** The version staged for next-launch apply, or null if none this session. */
export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** A check in flight this session, shared by overlapping callers (see below). */
let inFlight: Promise<UpdateCheckResult> | null = null;

/**
 * Check EAS Hosting for a newer web bundle, download and verify it in the
 * background, then write the apply-on-next-launch pointer.
 *
 * - Only runs in a packaged (production) build.
 * - A failed check resolves to 'error'; the app always loads normally.
 *
 * Returns the outcome so the in-app "Check for updates" button can report it
 * deterministically; the boot and Help-menu callers ignore the return value.
 *
 * De-duplicated: a call that arrives while another is still running (e.g. the
 * in-app button clicked during the boot check) joins the same promise rather
 * than starting a second download that would race the first's temp dir.
 */
export function checkForUpdates(): Promise<UpdateCheckResult> {
  inFlight ??= runCheck().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** One actual check + staging pass. Serialized by `checkForUpdates`. */
async function runCheck(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) return 'unavailable';

  try {
    // Cache-bust the manifest fetch so CDN edge caches don't hide new versions.
    const manifestUrl = `${UPDATE_BASE}/desktop-update.json?ts=${Date.now()}`;
    const remote = await fetchJson<UpdateManifest>(manifestUrl);

    const activeVersion = getActiveVersion();
    if (remote.version === activeVersion) {
      console.log('[ota] Up to date:', remote.version);
      return 'current';
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

    // Record + push so the renderer learns of the update whether it was already
    // listening (live push) or mounts after this point (pulls via getPending).
    pendingUpdateVersion = remote.version;
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('octochat:update-ready', remote.version);
    }
    return 'updated';
  } catch (err) {
    console.error('[ota] Update check failed (will retry on next launch):', err);
    return 'error';
  }
}
