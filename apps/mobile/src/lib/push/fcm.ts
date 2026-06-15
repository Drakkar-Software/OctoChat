/**
 * Push notifications — web/default no-op implementation.
 *
 * Firebase Cloud Messaging arrives via `@react-native-firebase/messaging`, which
 * has no web support; the web/desktop app relies on the live SSE stream +
 * `notify.ts` instead. These no-ops let cross-platform code (`use-push`) import
 * unconditionally — the real implementation is `fcm.native.ts`, which Metro
 * resolves on iOS/Android.
 */

/** Data payload of an octochat chat-change push (data-only — chat is E2EE). */
export interface PushData {
  type?: string;
  spaceId?: string;
  roomId?: string;
  /** Public-space rooms carry the room id here, not in `roomId` (see fcm.native.ts). */
  docId?: string;
}

/**
 * Per-space FCM topic. MUST match the Whistler bridge's namespace transform
 * (`octospaces` namespace + dot→hyphen-sanitized `octospaces.log.changed.<spaceId>`).
 */
export const pushTopicForSpace = (spaceId: string): string =>
  `octospaces-octospaces-log-changed-${spaceId}`;

/** Per-user FCM topic for push self-exclusion. See `fcm.native.ts`. */
export const pushTopicForUser = (userId: string): string => `octospaces-user-${userId}`;

export async function ensurePushPermission(): Promise<boolean> {
  return false;
}

export async function subscribeSpacePush(_spaceId: string): Promise<void> {}

export async function unsubscribeSpacePush(_spaceId: string): Promise<void> {}

export async function subscribeUserPush(_userId: string): Promise<void> {}

export async function unsubscribeUserPush(_userId: string): Promise<void> {}

/** Register the FCM background-message handler. Call once at module scope. */
export function registerBackgroundPushHandler(): void {}

/** Create the Android chat-notification channel. No-op on web (Android-only concept). */
export async function ensureNotificationChannel(): Promise<void> {}

/** Subscribe to foreground pushes. Returns an unsubscribe fn. */
export function onForegroundPush(_cb: (data: PushData) => void): () => void {
  return () => {};
}

/** Route to the room a tapped notification points at (incl. cold start). Returns cleanup. */
export function onPushOpenNavigate(_onOpen: (data: PushData) => void): () => void {
  return () => {};
}

/** Route to the room a tapped notifee (Android) notification points at. No-op on web. */
export function onNotifeeOpenNavigate(_onOpen: (data: PushData) => void): () => void {
  return () => {};
}

/** Number of spaces currently subscribed to via FCM topics. Always 0 on web. */
export function getFcmTopicCount(): number {
  return 0;
}

/** Subscribe to topic-count changes. Returns an unsubscribe fn. No-op on web. */
export function subscribeFcmTopicCount(_fn: (count: number) => void): () => void {
  return () => {};
}
