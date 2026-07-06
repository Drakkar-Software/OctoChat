import {
  SunglassesCore,
  createLazyClient,
  captureException as sgCaptureException,
  type CaptureExceptionOptions,
} from '@drakkar.software/sunglasses-core';
import { AsyncStorageAdapter } from '@drakkar.software/sunglasses-storage-async-storage';
import { StarfishAnalyticsAdapter } from '@drakkar.software/sunglasses-adapter-starfish';
import { StarfishClient } from '@drakkar.software/starfish-client';
import { SYNC_BASE, SYNC_NAMESPACE } from '@/lib/octochat-config';
import { ANALYTICS_EVENTS } from '@/lib/analytics/constants';

/**
 * Type-safe event map — extend with known custom events as the app grows.
 * Known events get a checked property shape; the permissive `Record` baseline
 * keeps `SunglassesCore.capture()` usable for any not-yet-typed event name.
 *
 * Privacy: NEVER put message content (or any PII) in event properties — this is
 * an E2EE app and these events leave the device for the analytics silo.
 */
type AppEvents = {
  /** A message/reply was successfully handed off to send (no content captured). */
  message_sent: {
    surface: 'channel' | 'thread';
    has_attachment: boolean;
    is_reply: boolean;
    text_length: number;
  };
} & Record<string, Record<string, unknown> | undefined>;

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
 * Creates a Starfish batch-push adapter pointing at the `dk` namespace `events`
 * collection (the standalone `analytics` namespace was merged into `dk`
 * server-side — see Infra commit 9a0bf38). Each flush writes a Parquet file to
 * S3 via the `starfish-events` server plugin — everything stays in our own silo.
 *
 * Unhandled exceptions are captured by SunGlasses' built-in autocapture: the
 * `autoCaptureErrors` prop on `<SunglassesProvider>` (in `app/_layout.tsx`)
 * installs the global handler, and `<SunglassesErrorBoundary>` catches
 * render-phase errors. Both publish `$error` events through this client.
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
    namespace: SYNC_NAMESPACE, // `dk` in deploy — same namespace as chat sync; collection has write_roles: ["public"], no capProvider
  });

  const client = await SunglassesCore.create({
    storage: new AsyncStorageAdapter(),
    adapters: [
      new StarfishAnalyticsAdapter({
        client: syncClient,
        app: ANALYTICS_APP,
        // StarfishClient.push() does NOT add the /push/ prefix; only /v1/{namespace} is
        // prepended by applyNamespace(). We must include /push/ explicitly to reach:
        //   SYNC_BASE/v1/dk/push/events/{app}/{batchId}
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

/**
 * Manually publish an exception through SunGlasses as a `$error` event. Thin
 * wrapper over the core `captureException` that injects the singleton client.
 *
 * Use this in `catch` blocks for errors you handle but still want visibility
 * into (defaults to `handled: true`). Global unhandled errors and render-phase
 * crashes are captured automatically via `<SunglassesProvider autoCaptureErrors>`
 * and `<SunglassesErrorBoundary>` — no manual call needed for those.
 *
 * Safe before {@link initAnalytics} resolves (the lazy client no-ops).
 */
export function captureException(error: unknown, options?: CaptureExceptionOptions): void {
  sgCaptureException(analytics, error, options);
}

/**
 * Capture a "message sent" event. Call AFTER a send is successfully handed off
 * (live or queued to the outbox) so failed attachment uploads aren't counted.
 *
 * Privacy: only non-PII metadata is recorded — never the message text itself.
 * Safe to call before {@link initAnalytics} resolves (the lazy client no-ops).
 */
export function captureMessageSent(props: {
  surface: 'channel' | 'thread';
  hasAttachment: boolean;
  textLength: number;
}): void {
  analytics.capture(ANALYTICS_EVENTS.MESSAGE_SENT, {
    surface: props.surface,
    has_attachment: props.hasAttachment,
    is_reply: props.surface === 'thread',
    text_length: props.textLength,
  });
}
