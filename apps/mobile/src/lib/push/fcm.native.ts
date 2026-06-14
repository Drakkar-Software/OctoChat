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
import notifee, { EventType } from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { handleBackgroundPush } from './background-notify';
import { MESSAGES_CHANNEL_ID, MESSAGES_CHANNEL_VIBRATION_PATTERN } from './channel';

export interface PushData {
  type?: string;
  spaceId?: string;
  roomId?: string;
  // Legacy field — old push payloads used `docId` instead of `roomId`.
  // Kept for forward-compat; `notification-open-room.ts` falls back to it.
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
    // Single short pulse instead of the OEM default multi-pulse pattern — one
    // notification = one buzz (see the notification-spam fix). Must match the
    // notifee channel definition in `background-notify.native.ts` (immutable channel).
    vibrationPattern: MESSAGES_CHANNEL_VIBRATION_PATTERN,
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

const notifeeDataToPush = (n?: { data?: { [key: string]: unknown } }): PushData => ({
  type: asStr(n?.data?.type),
  spaceId: asStr(n?.data?.spaceId),
  roomId: asStr(n?.data?.roomId),
  docId: asStr(n?.data?.docId),
});

// A warm tap (app backgrounded, not quit) is delivered to notifee's BACKGROUND
// event handler, which runs before React is foreground-ready. Stash it here so
// `onNotifeeOpenNavigate` can route once the app is active again.
let pendingNotifeeOpen: PushData | null = null;

/**
 * Register the FCM background handler. Android pushes are DATA-ONLY (no FCM
 * `notification` block — see the Infra bridge formatter / docs/push-fcm.md), so the
 * OS does NOT auto-display them: this headless task builds the banner itself, with
 * the real decrypted message when the `preview` setting is on (`background-notify`).
 * Also registers notifee's required background-event handler (iOS still uses the
 * OS-rendered visible-alert push, so this is effectively Android's display path).
 */
let bgRegistered = false;
export function registerBackgroundPushHandler(): void {
  if (bgRegistered) return;
  bgRegistered = true;
  messaging().setBackgroundMessageHandler((msg) =>
    handleBackgroundPush({
      type: asStr(msg.data?.type),
      spaceId: asStr(msg.data?.spaceId),
      roomId: asStr(msg.data?.roomId),
      docId: asStr(msg.data?.docId),
    }),
  );
  // notifee requires a background-event handler when its notifications can be
  // interacted with while backgrounded. A press lands here; stash for routing.
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    if (type === EventType.PRESS) pendingNotifeeOpen = notifeeDataToPush(detail.notification);
  });
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

/**
 * Notification-tap navigation for the NOTIFEE-built banners (Android data-only
 * path). Mirrors {@link onPushOpenNavigate} but for notifee's event model, covering
 * all three launch states: cold-start (`getInitialNotification`), foreground tap
 * (`onForegroundEvent` PRESS), and warm-background tap (delivered to the background
 * handler, stashed in `pendingNotifeeOpen`, drained when the app returns to active).
 * Forwards the push `data` to `onOpen`, same as the RN-Firebase path — the caller
 * resolves the room and routes. No-op on iOS (its banners aren't notifee-built, so
 * none of these fire), so it's safe to subscribe alongside `onPushOpenNavigate`.
 */
export function onNotifeeOpenNavigate(onOpen: (data: PushData) => void): () => void {
  const drainPending = (): void => {
    if (!pendingNotifeeOpen) return;
    const data = pendingNotifeeOpen;
    pendingNotifeeOpen = null;
    onOpen(data);
  };
  // A warm tap may have stashed before this subscriber mounted.
  drainPending();
  // Cold start: app launched by tapping a notifee notification while quit.
  void notifee.getInitialNotification().then((initial) => {
    if (initial) onOpen(notifeeDataToPush(initial.notification));
  });
  // Tap while the app is foreground.
  const offForeground = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) onOpen(notifeeDataToPush(detail.notification));
  });
  // Warm-background tap is a background event; route it when the app becomes active.
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') drainPending();
  });
  return () => {
    offForeground();
    appStateSub.remove();
  };
}
