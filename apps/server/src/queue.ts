import { connect, type NatsConnection } from "@nats-io/transport-node";
import { CustomQueue, type Queue } from "@drakkar.software/starfish-queuing";

/**
 * NATS transport for the Starfish queuing plugin. The TS queuing package ships
 * no NATS backend, so we wrap the `nats` client in a `CustomQueue` whose
 * `onPublish` forwards each change-event to NATS. A separate Whistlers process
 * subscribes to NATS and re-serves the events as SSE (see
 * `apps/server/docs/notifications-sse.md`).
 *
 * When `NATS_URL` is unset (local dev), returns a no-op queue so the server
 * still boots — change-events simply aren't published.
 */
export async function createNatsQueue(): Promise<{ queue: Queue; nc: NatsConnection | null }> {
  const url = process.env.NATS_URL;
  if (!url) {
    console.warn("[OctoChat] NATS_URL unset — chat change-events are not published (dev).");
    return { queue: new CustomQueue({ onPublish: () => {} }), nc: null };
  }
  const nc = await connect({ servers: url, name: "octochat-server" });
  console.log(`[OctoChat] Publishing chat change-events to NATS at ${url}`);
  const queue = new CustomQueue({
    onPublish: (subject, payload) => {
      nc.publish(subject, payload);
    },
  });
  return { queue, nc };
}
