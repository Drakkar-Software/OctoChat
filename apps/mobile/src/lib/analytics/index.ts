import { SunglassesCore, createLazyClient } from '@drakkar.software/sunglasses-core';
import { AsyncStorageAdapter } from '@drakkar.software/sunglasses-storage-async-storage';
import { StarfishAnalyticsAdapter } from '@drakkar.software/sunglasses-adapter-starfish';
import { StarfishClient } from '@drakkar.software/starfish-client';
import { SYNC_BASE } from '@/lib/octochat-config';

// Type-safe event map — extend with known custom events as the app grows.
// For now the permissive `Record<string, unknown>` baseline is enough since
// SunglassesCore.capture() accepts any string event name.
type AppEvents = Record<string, Record<string, unknown> | undefined>;

/**
 * Module-level analytics singleton. Safe to call at any time — all methods
 * are no-ops until `initAnalytics()` resolves. After init, every call
 * delegates to the real SunglassesCore client.
 */
export const analytics = createLazyClient<AppEvents>();

const ANALYTICS_APP = 'octochat';

// Guard against double-init (React StrictMode double-effects, fast-refresh, etc.)
let started = false;

/**
 * Initialize the SunGlasses analytics pipeline.
 *
 * Creates a Starfish batch-push adapter pointing at the `analytics` namespace
 * `events` collection. Each flush writes a Parquet file to S3 via the
 * `starfish-events` server plugin — no data goes to PostHog cloud.
 *
 * PostHog exception autocapture is wired separately via `PostHogProvider` in
 * `app/_layout.tsx`, forwarding events to this client via `createPostHogBeforeSend`.
 *
 * Fire-and-forget from `app/_layout.tsx` inside a `useEffect` — the lazy client
 * silently swallows calls that arrive before this resolves.
 *
 * defaultOptIn: true — events flow immediately with no consent gate.
 * Add `analytics.optOut()` call-sites when a consent toggle is introduced.
 */
export async function initAnalytics(): Promise<void> {
  if (started) return;
  started = true;

  const syncClient = new StarfishClient({
    baseUrl: SYNC_BASE,
    namespace: 'analytics', // separate analytics silo; collection has write_roles: ["public"], no capProvider
  });

  const client = await SunglassesCore.create({
    storage: new AsyncStorageAdapter(),
    adapters: [
      new StarfishAnalyticsAdapter({
        client: syncClient,
        app: ANALYTICS_APP,
        // StarfishClient.push() does NOT add the /push/ prefix; only /v1/{namespace} is
        // prepended by applyNamespace(). We must include /push/ explicitly to reach:
        //   SYNC_BASE/v1/analytics/push/events/{app}/{batchId}
        pathTemplate: '/push/events/{app}/{batchId}',
      }),
    ],
    platform: 'react-native',
    appName: 'octochat-mobile',
    defaultOptIn: true,
    enableSessionTracking: true,
    debug: __DEV__,
  });

  analytics.init(client);
}
