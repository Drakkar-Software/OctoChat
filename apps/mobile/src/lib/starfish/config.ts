/**
 * Starfish sync server base URL.
 *
 * Web/dev defaults to the local server (see apps/server, port 8787). Override
 * with EXPO_PUBLIC_STARFISH_URL. Native LAN/emulator handling is refined in the
 * native runtime step.
 */
export const SYNC_BASE = process.env.EXPO_PUBLIC_STARFISH_URL ?? 'http://localhost:8787';
