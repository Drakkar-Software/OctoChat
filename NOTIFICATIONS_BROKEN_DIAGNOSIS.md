# Notifications broken — root cause + fix (2026-06-08)

## Root cause (confirmed live on the server)
The official **`drakkarsoftware/whistlers` Docker image crash-loops** — both
`whistlers-sse` (web/desktop) and `whistlers-fcm` (mobile) were `Restarting (1)`,
so **all three platforms went dark**.

`docker logs` showed `ERR_MODULE_NOT_FOUND`:
- `whistlers-sse` → `Cannot find package '@nats-io/transport-node'` (needed by the
  NATS queue adapter — so SSE never even connects to NATS; it prints
  "SSE server listening" then dies).
- `whistlers-fcm` → `Cannot find package 'firebase-admin'`.

Why: the Dockerfile runtime stage copies only the **root** `node_modules` next to
`dist`, but pnpm's default **isolated linker** symlinks the `whistlers` package's
own deps under `packages/ts/whistlers/node_modules` — which the image never copies.
`docker run … ls /app/node_modules` confirmed only `typescript` + `.pnpm/` at top
level. So `dist/bin/server.js` can't resolve its lazy imports and crashes.

**Trigger:** Infra `789b4d4` ("run whistlers from the official image + config files")
retired the custom `drakkar-bridge` (which had its own working `package.json`) and
was the **first** use of the official image as a NATS bridge — exposing a Dockerfile
dep-resolution bug that was never exercised before.

## Both initial suspects RULED OUT
- **Starfish a19→a21 queue bump** — additive. `include_params=True` still set per
  chat collection (`server.py:351`); queue plugin write-path unchanged a13→a21
  (only `include_identity` added). drakkar-sync still publishes
  `octochat.chat.changed.<spaceId>` to NATS.
- **Whistlers 0.9.0 declarative FCM templating** — it **does exist** (`origin/main`
  `74d181a`, release 0.9.0) and matches the Infra `whistlers-fcm.config.json.j2`
  DSL exactly. (My first pass saw a stale local checkout at 0.8.0.) The SSE config
  was valid and topic-identical to the old bridge all along.

## Fix (Whistlers repo — NOT committed/tagged; you tag releases)
- Added root **`.npmrc`** with `node-linker=hoisted` → flat root `node_modules`
  contains every runtime dep (queue adapters + `firebase-admin`).
- **Also added `.npmrc` to the Dockerfile builder `COPY` line** — the build runs in
  an isolated filesystem with only the files it explicitly copies, so without this
  `pnpm install` in-image reverts to the isolated linker and the fix is a no-op.
- Bumped `0.9.0 → 0.9.1` + CHANGELOG `Fixed` entry.

Verified **locally**: `pnpm install --frozen-lockfile` keeps the lockfile;
`@nats-io/transport-node`, `firebase-admin`, `mqtt` all resolve at top level;
`pnpm -r build` + 218 tests pass; a `/app`-layout simulation imports all three OK.
The docker daemon was down here, so the **real `docker build` was not run.**

## To restore service
1. **Build once and check the layout before the broad redeploy:**
   `docker build -t whistlers-test .` then
   `docker run --rm --entrypoint sh whistlers-test -c 'ls /app/node_modules'` —
   expect `@nats-io`, `firebase-admin`, `mqtt` at the top level.
2. Tag the Whistlers `0.9.1` release → CI rebuilds `:stable` / `:latest` / `:0.9.1`.
3. Redeploy Infra (ansible) to pull the rebuilt image. No Infra config change
   needed — the config was correct; only the image was broken.
   (The deployed env is running `:latest`.)
