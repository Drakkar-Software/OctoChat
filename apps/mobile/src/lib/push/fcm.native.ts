/**
 * Push notifications — native (iOS/Android) Firebase Cloud Messaging.
 *
 * The device subscribes to a per-space FCM topic; the Whistler bridge publishes
 * `octochat.chat.changed.<spaceId>` events to it (see `octochat-fcm` in the Infra
 * bridge). The bridge sends a VISIBLE notification with GENERIC text ("New message
 * in another room") plus `{ spaceId, roomId }` data — chat is E2E-encrypted, so no
 * message content crosses the wire. A visible (alert) push is shown by the OS
 * reliably even when the app is force-quit, unlike silent/data-only pushes (which
 * iOS throttles and drops for killed apps). The app does NOT build the banner —
 * the OS does; we only handle the tap (route to the room) and a foreground refresh.
 *
 * RN-Firebase auto-initializes the default app natively from `google-services.json`
 * / `GoogleService-Info.plist` (config plugin in `app.json`) — no JS init needed.
 */
import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export interface PushData {
  type?: string;
  spaceId?: string;
  roomId?: string;
  // Public-space rooms (`pubspace`) carry the room id as `docId`, not `roomId`
  // (server `config.ts` storagePath `pubspaces/{ownerId}/{spaceId}/{docId}`). We
  // accept both so a public-channel push can resolve once the bridge forwards it.
  docId?: string;
}

export const pushTopicForSpace = (spaceId: string): string =>
  `octochat-octochat-chat-changed-${spaceId}`;

/**
 * Per-USER FCM topic. The device subscribes to its own account's user-topic so the
 * Whistler bridge can address a chat push to an FCM CONDITION that EXCLUDES it
 * (`'<space-topic>' in topics && !('<user-topic>' in topics)`) — the message author
 * therefore never gets a push for their own message, on any of their devices. Only
 * the author's devices subscribe to this topic, so the exclusion targets exactly
 * them. MUST match the bridge's `octochat-user-<userId>` builder (see Infra
 * `bridge/src/apps/octochat/format.ts`); `userId` is the account id the server
 * reports as the write `identity` (sha256(edPub)[:16] — 32-char hex, topic-safe).
 */
export const pushTopicForUser = (userId: string): string => `octochat-user-${userId}`;

const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Android notification channel id for chat pushes. Single source of truth:
 * `ensureNotificationChannel` creates it, `app.json`'s `expo-notifications`
 * `defaultChannel` routes the bridge's channel-less FCM messages to it, and it
 * matches the bridge's documented `channelId` so it stays forward-compatible if
 * the bridge ever sets one.
 */
const MESSAGES_CHANNEL_ID = 'messages';

/**
 * Create the high-importance "Messages" channel so chat pushes show a heads-up
 * banner (the FCM auto-fallback channel is IMPORTANCE_DEFAULT — tray only, no
 * heads-up) and get a user-controllable entry in Android notification settings.
 *
 * Must run unconditionally on every cold start (NOT gated on permission/sign-in)
 * and BEFORE any background push renders: once `defaultChannel` points here, every
 * channel-less push routes to this id, so the channel must already exist. The
 * topic-subscribe model guarantees the app has run before any space push can
 * arrive (a device only receives one after `subscribeToTopic`), so creating it at
 * module-scope init is sufficient. `setNotificationChannelAsync` is idempotent.
 * iOS has no notification channels — no-op there (and on web, via `fcm.ts`).
 */
export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(MESSAGES_CHANNEL_ID, {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    showBadge: true,
  });
}

export async function ensurePushPermission(): Promise<boolean> {
  // FCM authorization (iOS prompt; registers the APNs/FCM token).
  const status = await messaging().requestPermission();
  const granted =
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL;
  // Android 13+ needs the runtime POST_NOTIFICATIONS grant for the OS to show
  // notifications; `messaging().requestPermission()` doesn't cover it.
  if (granted && Platform.OS === 'android') await Notifications.requestPermissionsAsync();
  return granted;
}

/**
 * Module-level register of currently-subscribed space ids. Mirrors the live
 * Firebase topic subscriptions so the settings DIAGNOSTICS card can show the
 * count without re-asking Firebase (which has no listing API).
 */
const subscribedSpaces = new Set<string>();
const topicCountListeners = new Set<(count: number) => void>();
const emitTopicCount = (): void => {
  const n = subscribedSpaces.size;
  for (const fn of topicCountListeners) fn(n);
};

export const subscribeSpacePush = async (spaceId: string): Promise<void> => {
  await messaging().subscribeToTopic(pushTopicForSpace(spaceId));
  if (!subscribedSpaces.has(spaceId)) {
    subscribedSpaces.add(spaceId);
    emitTopicCount();
  }
};

export const unsubscribeSpacePush = async (spaceId: string): Promise<void> => {
  await messaging().unsubscribeFromTopic(pushTopicForSpace(spaceId));
  if (subscribedSpaces.delete(spaceId)) emitTopicCount();
};

/**
 * Subscribe/unsubscribe the device to its account's per-user topic (self-exclusion;
 * see {@link pushTopicForUser}). Not counted in the spaces diagnostics — it's a
 * single account-scoped topic, not a per-space subscription.
 */
export const subscribeUserPush = async (userId: string): Promise<void> => {
  await messaging().subscribeToTopic(pushTopicForUser(userId));
};

export const unsubscribeUserPush = async (userId: string): Promise<void> => {
  await messaging().unsubscribeFromTopic(pushTopicForUser(userId));
};

export function getFcmTopicCount(): number {
  return subscribedSpaces.size;
}

export function subscribeFcmTopicCount(fn: (count: number) => void): () => void {
  topicCountListeners.add(fn);
  fn(subscribedSpaces.size);
  return () => {
    topicCountListeners.delete(fn);
  };
}

/**
 * Required by RN-Firebase even though our pushes carry a `notification` block (the
 * OS displays those directly, and this handler is NOT invoked for them while
 * backgrounded). Kept as a no-op to satisfy the API and absorb any data-only edge.
 */
let bgRegistered = false;
export function registerBackgroundPushHandler(): void {
  if (bgRegistered) return;
  bgRegistered = true;
  messaging().setBackgroundMessageHandler(async () => {});
}

export function onForegroundPush(cb: (data: PushData) => void): () => void {
  // Foreground: the OS does NOT auto-display notification messages, so refresh in
  // place (the open room pulls; the unread badge covers the rest). No banner — the
  // user is already looking at the app.
  return messaging().onMessage((msg) => {
    cb({ type: asStr(msg.data?.type), spaceId: asStr(msg.data?.spaceId), roomId: asStr(msg.data?.roomId) });
  });
}

/**
 * Wire notification-tap navigation. Both the warm-tap and cold-start paths forward
 * the push `data` to `onOpen` — the caller (in React context) resolves the room's
 * real name/kind from the rooms registry and navigates (see `openRoomFromPush`).
 * We deliberately do NOT navigate here: the tap can fire before the session is
 * restored on cold start, and only the React side knows when it's safe to route.
 */
export function onPushOpenNavigate(onOpen: (data: PushData) => void): () => void {
  const emit = (data?: { [key: string]: string | object }): void =>
    onOpen({
      type: asStr(data?.type),
      spaceId: asStr(data?.spaceId),
      roomId: asStr(data?.roomId),
      docId: asStr(data?.docId),
    });
  // Tap while the app is backgrounded.
  const unsub = messaging().onNotificationOpenedApp((msg) => emit(msg.data));
  // Cold start: app opened by tapping the notification while quit.
  void messaging()
    .getInitialNotification()
    .then((msg) => {
      if (msg) emit(msg.data);
    });
  return unsub;
}
