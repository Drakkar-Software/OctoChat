/**
 * Per-identity notification preferences, persisted to the platform KV store
 * (localStorage on web, AsyncStorage on native). Kept as a module-level snapshot
 * so non-React callers — `notify.ts` and the SSE room-change callback in
 * `unread-context` — can read the current settings synchronously, while React
 * consumers subscribe via {@link NotificationSettingsProvider} (`useSyncExternalStore`).
 *
 * The snapshot seeds with safe defaults so a notification that fires before kv
 * hydrates still reads something sane; the per-identity values overwrite it on load.
 */
import { Platform } from 'react-native';

import { kvGet, kvSet } from './starfish/kv';

/** Selectable desktop notification chime (synthesized in `notification-sound.ts`).
 *  Web/desktop-only; ignored on native (push sound is OS/channel-controlled). */
export type NotificationSound = 'ping' | 'pop' | 'chime' | 'blip';

export const NOTIFICATION_SOUNDS: NotificationSound[] = ['ping', 'pop', 'chime', 'blip'];

export interface NotificationSettings {
  /** Master switch — off silences everything (web/desktop toasts AND native push
   *  topic subscriptions). */
  enabled: boolean;
  /** Decrypt the latest message and show its text in the notification: on web/desktop
   *  (`notify.ts`) and on Android, where the headless background handler decrypts and
   *  builds the banner (`push/background-notify.native`) — including on the lock screen.
   *  iOS banners are OS-rendered from the generic FCM payload and unaffected. Off keeps
   *  the privacy-preserving generic "New message" body everywhere. */
  preview: boolean;
  /** Play a sound with the notification (web/desktop: the toast isn't silent). */
  sound: boolean;
  /** Which chime to play on desktop (the renderer synthesizes it; see
   *  `notification-sound.ts`). Honored only on desktop — web toasts use the OS
   *  default sound and native push follows the platform channel. */
  soundName: NotificationSound;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  // Default previews on for Android, where the headless handler decrypts and
  // renders the banner. iOS can't render decrypted previews (the OS builds the
  // banner from the generic FCM payload), so it stays off and locked; web/desktop
  // default off for privacy and can be opted in.
  preview: Platform.OS === 'android',
  sound: true,
  soundName: 'ping',
};

const settingsKey = (userId: string) => `octochat.notifications.${userId}`;

let snapshot: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS;
const listeners = new Set<() => void>();

/** The live settings — synchronous, for `notify.ts` and the SSE callback. */
export function getNotificationSettings(): NotificationSettings {
  return snapshot;
}

/** Subscribe to snapshot changes (drives `useSyncExternalStore`). */
export function subscribeNotificationSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replace the live snapshot and notify React consumers. */
export function setNotificationSettings(next: NotificationSettings): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Reset to defaults on sign-out so a fresh session never inherits the prior one's. */
export function resetNotificationSettings(): void {
  setNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
}

/** Tolerant parse: any missing/garbage field falls back to its default. */
function coerce(raw: unknown): NotificationSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_NOTIFICATION_SETTINGS;
  const r = raw as Partial<Record<keyof NotificationSettings, unknown>>;
  const pick = (k: 'enabled' | 'preview' | 'sound') =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_NOTIFICATION_SETTINGS[k];
  // soundName is a string enum, not a boolean — an unknown/garbage value falls
  // back to the default rather than passing through.
  const soundName = NOTIFICATION_SOUNDS.includes(r.soundName as NotificationSound)
    ? (r.soundName as NotificationSound)
    : DEFAULT_NOTIFICATION_SETTINGS.soundName;
  return { enabled: pick('enabled'), preview: pick('preview'), sound: pick('sound'), soundName };
}

/** Read this identity's persisted settings (does NOT mutate the snapshot — the
 *  provider sets it under a staleness guard). */
export async function loadNotificationSettings(userId: string): Promise<NotificationSettings> {
  const raw = await kvGet(settingsKey(userId));
  if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

/** Merge a patch into the live snapshot and persist it for the identity. */
export async function saveNotificationSettings(
  userId: string,
  patch: Partial<NotificationSettings>,
): Promise<void> {
  const next = { ...snapshot, ...patch };
  setNotificationSettings(next);
  await kvSet(settingsKey(userId), JSON.stringify(next));
}
