/**
 * Starfish sync server base URL.
 *
 * Web/dev defaults to the local server (see apps/server, port 8787). Override
 * with EXPO_PUBLIC_STARFISH_URL. Native LAN/emulator handling is refined in the
 * native runtime step.
 */
export const SYNC_BASE = process.env.EXPO_PUBLIC_STARFISH_URL ?? 'http://localhost:8787';

/**
 * Live change-event SSE endpoint. Served by the authenticated /events proxy on the
 * OctoChat Starfish server (same host as SYNC_BASE) which validates the caller's
 * cap-cert identity and whitelists only their member spaces before proxying the
 * Whistlers NATS→SSE stream. Override with EXPO_PUBLIC_EVENTS_URL.
 */
export const EVENTS_URL = process.env.EXPO_PUBLIC_EVENTS_URL ?? `${SYNC_BASE}/events`;
