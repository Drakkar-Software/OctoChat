/**
 * Wire the headless `@drakkar.software/octochat-sdk` to this app's platform.
 *
 * The SDK is platform-agnostic — it doesn't read Expo env or bind to a storage
 * backend. This bridges the two: it feeds the app's env-derived config and its
 * `kv` store (localStorage on web / AsyncStorage on native, resolved by Metro)
 * into the SDK. Call {@link initOctoChat} once at boot, before any SDK API runs
 * (see `app/_layout.tsx`, right after `configureStarfishPlatform()`).
 */
import { Platform } from 'react-native';

import { configureOctoChat, configureKv, configureLlm } from '@drakkar.software/octochat-sdk';
// The RAW platform kv impl (localStorage / AsyncStorage) is fed into the SDK's
// `configureKv` here; feature code reads through the DI accessor on the core entry.
import { kvGet, kvSet, kvRemove } from '@drakkar.software/octochat-sdk/platform';

import { generateText } from '@/lib/ai/llm-adapter';
import { SYNC_BASE, SYNC_NAMESPACE, EVENTS_URL, WEB_BASE } from '@/lib/octochat-config';
import { reportReachability } from '@/lib/connectivity';

let done = false;

export function initOctoChat(): void {
  if (done) return;
  done = true;
  configureOctoChat({
    syncBase: SYNC_BASE,
    syncNamespace: SYNC_NAMESPACE,
    eventsUrl: EVENTS_URL,
    webBase: WEB_BASE,
    // When a background Starfish revalidation succeeds after a 429/5xx cache-
    // fallback, flip the app back online so stale rooms re-pull and recover.
    onServerReachable: () => reportReachability(true),
  });
  configureKv({ get: kvGet, set: kvSet, remove: kvRemove });
  // Wire the on-device LLM for AI automations — native only. `expo-ai-kit` is a
  // native module (the web engine is an inert stub), so leaving the port
  // unconfigured on web makes AI automations report "not available on this device"
  // rather than silently posting empty output.
  if (Platform.OS !== 'web') configureLlm(generateText);
}
