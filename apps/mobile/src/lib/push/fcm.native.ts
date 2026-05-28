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
import { router } from 'expo-router';
import { Platform } from 'react-native';

export interface PushData {
  type?: string;
  spaceId?: string;
  roomId?: string;
}

export const pushTopicForSpace = (spaceId: string): string =>
  `octochat-octochat-chat-changed-${spaceId}`;

const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// No client-side channel: the bridge sends no custom channelId, so Android uses
// the FCM fallback channel (registered at app install) — the first post-install
// push displays without the app having run first.

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

export function onPushOpenNavigate(): () => void {
  const toRoom = (data?: { [key: string]: string | object }): void => {
    const roomId = asStr(data?.roomId);
    if (roomId) router.push({ pathname: '/room/[id]', params: { id: roomId } });
  };
  // Tap while the app is backgrounded.
  const unsub = messaging().onNotificationOpenedApp((msg) => toRoom(msg.data));
  // Cold start: app opened by tapping the notification while quit.
  void messaging()
    .getInitialNotification()
    .then((msg) => {
      if (msg) toRoom(msg.data);
    });
  return unsub;
}
