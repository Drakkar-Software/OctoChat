/**
 * OctoChat PWA service worker.
 *
 * Deliberately minimal: it exists to satisfy the browser's installability
 * criteria (a registered SW with a `fetch` handler) and to give a graceful
 * offline experience for the SPA shell — WITHOUT ever caching the hashed
 * `/_expo/static/**` bundles, which would risk pinning a stale app version.
 *
 * Strategy:
 *  - Navigation requests  → network-first, fall back to the cached app shell.
 *  - Everything else      → pass through to the network (the browser HTTP
 *    cache already handles the content-hashed assets correctly).
 */
const CACHE = 'octochat-shell-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SHELL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GETs; let the network handle the rest untouched.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // App-shell navigations: network-first with an offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error())),
    );
  }
  // All other GETs (including hashed bundles/assets) fall through to the
  // network — no respondWith, so the browser's default handling applies.
});
