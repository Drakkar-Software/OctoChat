import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  createSyncRouter,
  createCapCertRoleResolver,
  createInMemoryNonceCache,
  createInMemoryRevocationStore,
  createGracefulShutdown,
  saveConfig,
} from "@drakkar.software/starfish-server";
import { FilesystemObjectStore } from "@drakkar.software/starfish-server/node";
import { identitiesServerPlugin } from "@drakkar.software/starfish-identities";
import { sharingServerPlugin } from "@drakkar.software/starfish-sharing";

import { config } from "./config.js";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.STARFISH_DATA_DIR ?? "./data";

const store = new FilesystemObjectStore({ baseDir: DATA_DIR });

// Cap-cert auth: device caps (identities plugin) + member caps (sharing plugin).
const roleResolver = createCapCertRoleResolver({
  nonceCache: createInMemoryNonceCache({ windowMs: 5 * 60_000, maxEntries: 100_000 }),
  revocationStore: createInMemoryRevocationStore(),
  allowAnonymous: true, // public-read collections (profile, pairing)
  plugins: [identitiesServerPlugin, sharingServerPlugin],
});

const syncRouter = createSyncRouter({
  store,
  config,
  roleResolver,
});

await saveConfig(store, config);

const app = new Hono();

// Permissive dev CORS: echo the browser's requested headers on preflight so the
// cap-cert auth headers (Authorization: Cap, X-Starfish-*) are always allowed.
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "*";
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

// starfish-server is typed against the satellite workspace's hono copy; it's
// runtime-compatible with ours, so cast across the nominal type-identity gap.
app.route("/", syncRouter as unknown as Hono);

createGracefulShutdown();

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`OctoChat Starfish server listening on http://0.0.0.0:${info.port} (data: ${DATA_DIR})`);
});
