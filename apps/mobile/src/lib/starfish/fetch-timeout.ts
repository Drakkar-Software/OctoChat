/**
 * A `fetch` wrapper that bounds the CONNECT/TTFB phase only.
 *
 * Every Starfish request goes through the global `fetch` with no timeout and no
 * AbortSignal, and React Native's `fetch` on Android can hang indefinitely on a
 * stalled socket / network transition (Wi-Fi↔cellular, proxy, dropped link)
 * instead of rejecting. A hung pull in the room-open path freezes the loading
 * skeleton forever (see `use-room.ts`). This wrapper aborts a request that hasn't
 * RESPONDED within {@link CONNECT_TIMEOUT_MS}, turning an opaque infinite spinner
 * into a normal rejection the open path can surface as a retriable error.
 *
 * It clears the timer the moment `fetch()` settles — i.e. once response headers
 * arrive — so it bounds ONLY the connect phase. Body downloads (large
 * attachments) and long-lived streams (`/events` SSE) keep reading unbounded.
 * Mirrors the AbortController pattern in `use-server-health.ts`.
 */

const CONNECT_TIMEOUT_MS = 12_000; // generous: trips only on a truly stalled socket

export function fetchWithTimeout(timeoutMs = CONNECT_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Compose any caller-supplied signal so an unmount/cancel still propagates.
    const caller = init?.signal;
    if (caller) {
      if (caller.aborted) ctrl.abort();
      else caller.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    // `.finally` fires when fetch() resolves (headers received) OR rejects —
    // clearing the timer here bounds the connect phase, never the body read.
    return fetch(input as RequestInfo, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };
}
