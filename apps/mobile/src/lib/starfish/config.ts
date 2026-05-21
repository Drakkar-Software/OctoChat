/**
 * Starfish sync server base URL.
 *
 * Web/dev defaults to the local server (see apps/server, port 8787). Override
 * with EXPO_PUBLIC_STARFISH_URL. Native LAN/emulator handling is refined in the
 * native runtime step.
 */
export const SYNC_BASE = process.env.EXPO_PUBLIC_STARFISH_URL ?? 'http://localhost:8787';

/**
 * Live change-event SSE endpoint. Served by the Whistlers NATS→SSE gateway
 * (NOT the Starfish server) — see apps/server/docs/notifications-sse.md. Defaults
 * to the local docker-compose Whistlers (port 8080). Override with
 * EXPO_PUBLIC_EVENTS_URL.
 */
export const EVENTS_URL = process.env.EXPO_PUBLIC_EVENTS_URL ?? 'http://localhost:8080/events';
