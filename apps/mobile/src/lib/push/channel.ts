/**
 * Android chat-notification channel id — single source of truth, in a standalone
 * module so both `fcm.native` (creates it via expo-notifications) and
 * `background-notify.native` (posts via notifee) reference it without a circular
 * import between those two. Must stay in sync with `app.json`'s expo-notifications
 * `defaultChannel` (the bridge placeholder carries no `channelId`, so it routes to
 * the default). Unused on web/iOS (no notification channels there).
 *
 * Bumped `messages` → `messages-v2`: Android notification channels are IMMUTABLE
 * once created, so changing a channel's vibration pattern only takes effect under a
 * NEW id. The old `messages` channel (default multi-pulse vibration) lingers on
 * existing installs but is no longer targeted.
 */
export const MESSAGES_CHANNEL_ID = 'messages-v2';

/**
 * Single short pulse ([wait 0ms, vibrate 250ms]) — replaces Android's default
 * multi-pulse channel pattern so one notification is felt as ONE buzz, not two.
 * Shared by BOTH channel creators (expo-notifications + notifee) so they agree:
 * the channel is created once and is immutable, so a mismatch would be a coin toss
 * on which definition wins. See `docs/push-fcm.md` notification-spam fix.
 */
export const MESSAGES_CHANNEL_VIBRATION_PATTERN = [0, 250];
