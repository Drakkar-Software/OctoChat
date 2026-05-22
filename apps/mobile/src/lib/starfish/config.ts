/**
 * Starfish sync server base URL.
 *
 * Web/dev defaults to the local server (see apps/server, port 8787). Override
 * with EXPO_PUBLIC_STARFISH_URL. Native LAN/emulator handling is refined in the
 * native runtime step.
 */
export const SYNC_BASE = process.env.EXPO_PUBLIC_STARFISH_URL ?? 'http://localhost:8787';

/**
 * Path prefix prepended to every signed request path. EMPTY for the local dev
 * server (apps/server mounts the sync router at root, so paths are /pull, /push,
 * /events). For the deployed multi-tenant drakkar-sync, OctoChat is the
 * `octochat` namespace, so set EXPO_PUBLIC_STARFISH_PREFIX=/v1/octochat and
 * EXPO_PUBLIC_STARFISH_URL=https://<host>/sync. The prefix is part of the SIGNED
 * path (the SDK signs the endpoint path, not the baseUrl path), and nginx strips
 * the /sync mount so the server observes exactly /v1/octochat/... = the signed path.
 */
export const SYNC_PREFIX = process.env.EXPO_PUBLIC_STARFISH_PREFIX ?? '';

/**
 * Live change-event SSE endpoint. Served by the authenticated /events proxy on the
 * OctoChat Starfish server (same host as SYNC_BASE) which validates the caller's
 * cap-cert identity and whitelists only their member spaces before proxying the
 * Whistler NATS→SSE stream. Override with EXPO_PUBLIC_EVENTS_URL.
 */
export const EVENTS_URL = process.env.EXPO_PUBLIC_EVENTS_URL ?? `${SYNC_BASE}${SYNC_PREFIX}/events`;
