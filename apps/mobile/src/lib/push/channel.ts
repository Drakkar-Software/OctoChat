/**
 * Android chat-notification channel id — single source of truth, in a standalone
 * module so both `fcm.native` (creates it via expo-notifications) and
 * `background-notify.native` (posts via notifee) reference it without a circular
 * import between those two. Also matches the bridge's documented `channelId`.
 * Unused on web/iOS (no notification channels there).
 */
export const MESSAGES_CHANNEL_ID = 'messages';
