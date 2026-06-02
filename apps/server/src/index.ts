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
import { createProjectionServerPlugin } from "@drakkar.software/starfish-projection";

import { config } from "./config.js";
import { projections } from "./projections.js";
import { createNatsQueue } from "./queue.js";
import { createFileRevocationStore } from "./revocation-store.js";
import { makeSpaceRoleEnricher } from "./space-role.js";
import { makePubspaceRoleEnricher } from "./pubspace-role.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.STARFISH_DATA_DIR ?? "./data";

// Comma-separated allowlist (e.g. "https://app.example.com,https://staging.example.com").
// When empty (dev default) any origin is echoed; when set, only listed origins are allowed.
const CORS_ALLOW = (process.env.STARFISH_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (CORS_ALLOW.length === 0 && process.env.NODE_ENV === "production") {
  console.warn(
    "[OctoChat] SECURITY: STARFISH_CORS_ORIGINS is unset in production — CORS echoes any " +
      "Origin and any requested headers. Set it to your app's origin allowlist " +
      "(e.g. https://app.example.com) so a hostile page can't drive this API.",
  );
}

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
// windowMs MUST be >= 2x the accepted clock-skew (DEFAULT_MAX_SKEW_MS = 5 min) per the
// SDK contract: a request is accepted across [ts - skew, ts + skew], so the nonce must
// be remembered for the full 2x skew or a replay slot re-opens. So 10 min, not 5.
const nonceCache = createInMemoryNonceCache({ windowMs: 10 * 60_000, maxEntries: 100_000 });
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

// Publish a change-event to NATS after each successful push/append to the chat
// collections (params {spaceId,roomId} only — content stays E2E-encrypted).
// Whistlers consumes NATS and re-serves these as SSE. See
// `apps/server/docs/notifications-sse.md`. `streamchat`/`pubstream` (append-only
// stream rooms) and `pubspace` (public channels) publish on the SAME
// `octochat.chat.changed` topic so a write emits `octochat.chat.changed.<spaceId>`
// — the per-space SSE subscription + /events proxy drive every room kind live.
// (Appends fire the queue plugin's afterWrite just like a push — alpha.2 changelog.)
// NOTE: `pubspace` events carry `params.docId` (the room id, or `_rooms` for the
// public room registry) rather than `roomId` — the client routes on that.
// `includeIdentity` forwards the writer's account userId so the FCM bridge can
// exclude the author's own devices from the push (it never gets a notification
// for its own message). Metadata-only — no content — and opt-in per collection.
const { queue, nc } = await createNatsQueue();
const queuing = createQueuingServerPlugin({
  queue,
  collections: {
    chat: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    streamchat: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    pubstream: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    pubspace: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    // Unified Object collections ride the same per-space SSE topic. The index write
    // carries no roomId (params {spaceId} only); content writes carry {objectId} —
    // the client routes on those (see events.shared.ts).
    objindex: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    objdoc: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    objlog: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    pubobjindex: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    pubobjdoc: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
    pubobjlog: { topic: "octochat.chat.changed", includeParams: true, includeIdentity: true },
  },
});

// Pre-construct the space enricher so it's shared between the sync router
// (collection-level gating) and the /events proxy (membership validation).
const spaceEnricher = makeSpaceRoleEnricher(store);

// Issuer-binding for PUBLIC spaces (plaintext, cap-only). Composed with the space
// enricher below: each keys off a disjoint path param ({spaceId} vs {ownerId}) and
// returns [] otherwise, so unioning their roles is safe. The /events proxy stays
// space-only (public spaces don't use the encrypted-space SSE membership gate).
const pubspaceEnricher = makePubspaceRoleEnricher();
const roleEnricher: typeof spaceEnricher = async (auth, params) => [
  ...(await spaceEnricher(auth, params)),
  ...(await pubspaceEnricher(auth, params)),
];

// Maintains the public-space directory list at `_index/spaces/public`: its
// `afterWrite` hook folds every `pubspace` `_rooms` write into one queryable list
// document (see projections.ts). Writes in-process against the same `store`, so
// the `spaceindex` collection is `pullOnly` (clients read it, only this writes it).
const projection = createProjectionServerPlugin({ store, projections });

const syncRouter = createSyncRouter({
  store,
  config,
  roleResolver,
  // Grants `space:owner` / `space:member` (space-role.ts) plus the issuer-bound
  // `pubspace:owner` / `:reader` / `:writer` roles for public spaces (pubspace-role.ts).
  roleEnricher,
  plugins: [queuing, projection],
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
