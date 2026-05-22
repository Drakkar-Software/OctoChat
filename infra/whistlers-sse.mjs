// Dev launcher: run the local Whistlers package as a NATS→SSE gateway WITH CORS
// headers, so the browser app (origin http://localhost:8081) can connect
// cross-origin to the SSE endpoint on :8080.
//
// Why this exists: the stock Whistlers CLI (`bin/server.js`) constructs the SSE
// destination without CORS headers, so browsers block the EventSource with
// "No 'Access-Control-Allow-Origin' header". `SSEDestination` DOES support a
// `headers` option (intended for CORS) — this launcher passes it. The proper
// long-term fix is to add a CORS env var to the Whistlers CLI itself.
//
// Run:  QUEUE_URL=nats://localhost:4222 node infra/whistlers-sse.mjs
import { readFileSync } from "node:fs";
import {
  Whistler,
  NatsQueueAdapter,
  SSEDestination,
  parseConfigJson,
} from "@drakkar.software/whistlers";

const config = parseConfigJson(
  readFileSync(new URL("./whistlers.config.json", import.meta.url), "utf8"),
);

const destination = new SSEDestination({
  path: process.env.SSE_PATH ?? "/events",
  headers: { "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "*" },
});
const { port } = await destination.listen(Number(process.env.SSE_PORT ?? 8080));

const log = (lvl) => (...a) => console[lvl](`[${lvl}]`, ...a);
const whistler = new Whistler({
  queue: new NatsQueueAdapter({ servers: process.env.QUEUE_URL ?? "nats://localhost:4222" }),
  destination,
  config,
  logger: { info: log("info"), warn: log("warn"), error: log("error") },
});

await whistler.start();
console.log(`[octochat] Whistlers SSE (CORS) listening on http://localhost:${port}/events`);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await whistler.stop();
    process.exit(0);
  });
}
