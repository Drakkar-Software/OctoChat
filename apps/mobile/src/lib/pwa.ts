/**
 * Progressive Web App service-worker registration.
 *
 * Only meaningful on web production builds: native has no `navigator`, and
 * under `expo start` (`__DEV__`) a service worker would fight Fast Refresh by
 * caching the app shell. Everywhere else this is a no-op, mirroring the
 * feature-detect-and-no-op style in `desktop.ts`.
 *
 * The HTML head (manifest link, theme color, Apple touch icon) lives in
 * `public/index.html` — Expo's supported override for `web.output: "single"`.
 * The worker itself is `public/sw.js`, served at the origin root.
 */
import { Platform } from 'react-native';

export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || __DEV__) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Register after load so the SW install never competes with first paint.
  globalThis.window?.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures are non-fatal: the app still runs online.
    });
  });
}
