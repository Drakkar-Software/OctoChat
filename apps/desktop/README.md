# @octochat/desktop

The OctoChat **desktop** app. It's a thin [Electron](https://www.electronjs.org/)
shell that renders the existing Expo **web** build (`@octochat/mobile`) inside a
`BrowserWindow` — no UI is duplicated. One codebase, three runtimes: iOS,
Android, web, and now desktop.

## How it loads the app

| Mode | What Electron loads | Why |
| --- | --- | --- |
| **dev** | `http://localhost:8081` (the Expo dev server) | live reload / fast refresh |
| **prod** | `app://octochat/` — a custom protocol serving the exported `apps/mobile/dist/` | offline, packaged, stable origin |

In production a **privileged `app://` scheme** (registered in `src/main.ts`,
served by `src/protocol.ts`) streams the static export. It's `standard` + `secure`
so `localStorage`, `navigator.clipboard`, and cross-origin `fetch` to the sync
server all work, and it **falls back to `index.html`** for any unknown path so
expo-router's History-API routes (e.g. `/room/abc`) survive a reload.

## Prerequisites

- **Node ≥ 20** and **pnpm** (`pnpm@10.x`). Run `pnpm install` once from the repo root.
- The sibling **`Drakkar-Software/satellite`** repo must be present next to this
  repo — `apps/mobile` consumes its `@drakkar.software/starfish-*` packages via
  `link:`, and `expo export` (run by the packaging scripts) needs them.
- A running **sync server** for live data: `pnpm dev:server` from the repo root
  (defaults to `http://localhost:8787`).
- First `pnpm install` must be allowed to run the `electron` and `esbuild`
  postinstall scripts (they download binaries). This is pre-approved via
  `onlyBuiltDependencies` in the root `pnpm-workspace.yaml`.

## Scripts

Run from the repo root (`pnpm --filter @octochat/desktop <script>`) or from
within `apps/desktop` (`pnpm <script>`).

| Script | What it does |
| --- | --- |
| `dev` | Starts the Expo web dev server, waits for port 8081, then launches Electron pointed at it. |
| `build:main` | Compiles `src/main.ts` + `src/preload.ts` → `dist-electron/` with tsup. |
| `export` | Runs `@octochat/mobile`'s `export:web` (`expo export -p web --output-dir dist`). |
| `package` | `export` → `build:main` → `electron-builder` (full installers). |
| `package:dir` | Same as `package` but produces an **unpacked** app dir (faster, no installer). |
| `typecheck` | `tsc --noEmit` over the Electron source. |

The repo root also exposes `pnpm desktop` (= `dev`) and `pnpm desktop:package`
(= `package`).

## Develop

```bash
# from the repo root
pnpm dev:server        # terminal 1 — sync server on :8787 (optional, for live data)
pnpm desktop           # terminal 2 — Expo web on :8081 + Electron window
```

> **Note:** edits to `src/main.ts` / `src/preload.ts` (the Electron processes) do
> **not** hot-reload — the single-instance lock makes the re-spawned process quit.
> Restart `pnpm desktop` after changing them. Renderer (UI) changes hot-reload as
> usual via the Expo dev server.

## Build & package

```bash
# from the repo root
pnpm --filter @octochat/desktop package:dir   # quick: unpacked .app/dir in apps/desktop/release/
pnpm --filter @octochat/desktop package        # full installers (dmg/zip · nsis · AppImage)
```

Output lands in `apps/desktop/release/`. Targets are configured in
`electron-builder.yml`:

- **macOS** — `dmg` + `zip`
- **Windows** — `nsis` installer
- **Linux** — `AppImage`

Cross-building Windows/Linux from macOS may need extra tooling (wine for nsis,
Docker for AppImage); per-OS CI runners are the reliable path. The exported web
build is shipped as an unpacked resource (`extraResources` → `resources/web`),
not inside the asar, so the `app://` handler can stream it.

## Notes & gotchas

- **Notifications** (new-message toasts) have their own doc:
  [`NOTIFICATIONS.md`](NOTIFICATIONS.md). Short version: macOS never prompts on
  the current **ad-hoc-signed** builds (needs Developer ID); Windows/Linux show
  toasts with no prompt.
- **Unsigned macOS builds** are quarantined by Gatekeeper. Open via
  right-click → **Open**, or clear the flag:
  `xattr -dr com.apple.quarantine "apps/desktop/release/mac/OctoChat.app"`.
- **Sync server URL is baked at export time — and now required.** The renderer
  inlines `EXPO_PUBLIC_STARFISH_URL` + `EXPO_PUBLIC_STARFISH_NAMESPACE` at *build*
  time, not runtime. `scripts/check-build-env.mjs` runs first in `export` and
  **fails the build** if either is unset, so a packaged app can never silently
  fall back to `http://localhost:8787` (unreachable when distributed → seed
  unlocks but no rooms load). Set them before `export`/`package`:
  ```bash
  cross-env EXPO_PUBLIC_STARFISH_URL=https://dev-sync.drakkar.software/sync \
            EXPO_PUBLIC_STARFISH_NAMESPACE=octochat \
            pnpm --filter @octochat/desktop package
  ```
  A non-`localhost` `http://` URL is blocked by Chromium mixed-content rules — use
  `https://`.
- **App icons.** `build/icon.png` (1024×1024, square) is the source for Windows
  (`.ico`) and Linux. macOS uses `build/icon-mac.png` (set via `mac.icon`) — the
  same mark pre-shaped into the rounded "squircle" with transparent margins the
  dock expects, because macOS does **not** round icons itself (a full-bleed square
  shows as a square tile). To rebrand, replace `build/icon.png`, then regenerate
  the mac variant (824×824 body on a 1024 canvas, ~22.5% corner radius — Apple's
  grid) with ImageMagick:
  ```bash
  cd build
  magick icon.png -resize 824x824 /tmp/a.png
  magick -size 824x824 xc:black -fill white -draw "roundrectangle 0,0,823,823,185,185" /tmp/m.png
  magick /tmp/a.png \( /tmp/m.png -alpha off \) -compose CopyOpacity -composite /tmp/r.png
  magick -size 1024x1024 xc:none /tmp/r.png -gravity center -composite icon-mac.png
  ```

## Layout

```
apps/desktop/
  src/
    main.ts        # window, security, single-instance, menu, dev/prod loading
    protocol.ts    # app:// handler — serve dist/ + SPA fallback
    preload.ts     # contextBridge → window.octochat { version, platform, isElectron }
    constants.ts   # scheme/URLs, isDev, resolveDistDir()
  build/icon.png   # source icon for packaging
  electron-builder.yml
  tsup.config.ts   # builds main + preload
  tsconfig.json    # Node + Electron, CommonJS (separate from the Expo tsconfig)
  dist-electron/   # tsup output (gitignored)
  release/         # electron-builder output (gitignored)
```
