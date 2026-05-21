import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  createSyncRouter,
  createCapCertRoleResolver,
  createInMemoryNonceCache,
  createGracefulShutdown,
  saveConfig,
} from "@drakkar.software/starfish-server";
import { createEventsRoute } from "./events.js";
import { FilesystemObjectStore } from "@drakkar.software/starfish-server/node";
import { identitiesServerPlugin } from "@drakkar.software/starfish-identities";
import { sharingServerPlugin } from "@drakkar.software/starfish-sharing";
import { createQueuingServerPlugin } from "@drakkar.software/starfish-queuing";

import { config } from "./config.js";
import { createNatsQueue } from "./queue.js";
import { createFileRevocationStore } from "./revocation-store.js";
import { makeSpaceRoleEnricher } from "./space-role.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.STARFISH_DATA_DIR ?? "./data";

// Comma-separated allowlist (e.g. "https://app.example.com,https://staging.example.com").
// When empty (dev default) any origin is echoed; when set, only listed origins are allowed.
const CORS_ALLOW = (process.env.STARFISH_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function allowOrigin(reqOrigin: string | undefined): string {
  if (CORS_ALLOW.length === 0) return reqOrigin ?? "*"; // permissive dev default
  if (reqOrigin && CORS_ALLOW.includes(reqOrigin)) return reqOrigin;
  return CORS_ALLOW[0]; // a non-matching origin → browser blocks the response
}

const store = new FilesystemObjectStore({ baseDir: DATA_DIR });

// Cap-cert auth: device caps (identities plugin) + member caps (sharing plugin).
// Nonce cache stays in-memory (replay window is ephemeral by nature); the
// revocation store is file-backed so revokes survive a restart.
// Both are constructed separately so the /events route can share them (same nonce
// namespace for replay protection across all authenticated endpoints).
const nonceCache = createInMemoryNonceCache({ windowMs: 5 * 60_000, maxEntries: 100_000 });
const revocationStore = createFileRevocationStore(`${DATA_DIR}/_revocations.json`);
const roleResolver = createCapCertRoleResolver({
  nonceCache,
  revocationStore,
  allowAnonymous: true, // public-read collections (profile, pairing)
  plugins: [identitiesServerPlugin, sharingServerPlugin],
  // The resolver buffers the body to verify the request signature and checks
  // it against this global ceiling BEFORE the per-collection limit runs (it
  // defaults to 64 KB). Raise it to the largest collection cap (attachments,
  // ~11 MB) so blob uploads aren't 413'd here; per-collection `maxBodyBytes`
  // still enforces each collection's own tighter limit downstream.
  maxBodyBytes: 11_534_336,
});

// Publish a change-event to NATS after each successful push to the `chat`
// collection (params {spaceId,roomId} only — content stays E2E-encrypted).
// Whistlers consumes NATS and re-serves these as SSE. See
// `apps/server/docs/notifications-sse.md`.
const { queue, nc } = await createNatsQueue();
const queuing = createQueuingServerPlugin({
  queue,
  collections: { chat: { topic: "octochat.chat.changed", includeParams: true } },
});

// Pre-construct the space enricher so it's shared between the sync router
// (collection-level gating) and the /events proxy (membership validation).
const spaceEnricher = makeSpaceRoleEnricher(store);

const syncRouter = createSyncRouter({
  store,
  config,
  roleResolver,
  // Grants `space:owner` / `space:member` from each space's owner+roster record
  // (space-role.ts), gating the space keyring and room registry.
  roleEnricher: spaceEnricher,
  plugins: [queuing],
});

await saveConfig(store, config);

const app = new Hono();

// CORS: echo the browser's requested headers on preflight so the cap-cert auth
// headers (Authorization: Cap, X-Starfish-*) are always allowed. The allowed
// origin is gated by STARFISH_CORS_ORIGINS (permissive when unset — dev default).
app.use("*", async (c, next) => {
  const origin = allowOrigin(c.req.header("Origin"));
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": c.req.header("Access-Control-Request-Headers") ?? "*",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  await next();
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
});

// Authenticated SSE proxy: gates the Whistlers stream per caller's space membership.
// Must be mounted BEFORE the sync router so /events is not swallowed by its catch-all.
app.route(
  "/",
  createEventsRoute({ enricher: spaceEnricher, nonceCache, revocationStore }),
);

// starfish-server is typed against the satellite workspace's hono copy; it's
// runtime-compatible with ours, so cast across the nominal type-identity gap.
app.route("/", syncRouter as unknown as Hono);

// Runs the queuing plugin's shutdown hook, then drains the NATS connection.
createGracefulShutdown({
  plugins: [queuing],
  onShutdown: async () => {
    await nc?.drain();
  },
});

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`OctoChat Starfish server listening on http://0.0.0.0:${info.port} (data: ${DATA_DIR})`);
});
