export const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? 'phc_analytics_local';
export const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_URL ?? 'https://eu.posthog.com';

/**
 * Canonical custom-event names captured via the SunGlasses client. Centralized
 * here so call-sites and the typed `AppEvents` map stay in sync. `as const`
 * preserves the string literals required by the typed `analytics.capture()`.
 */
export const ANALYTICS_EVENTS = {
  MESSAGE_SENT: 'message_sent',
} as const;
