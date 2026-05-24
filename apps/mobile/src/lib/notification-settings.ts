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
import { kvGet, kvSet } from './starfish/kv';

export interface NotificationSettings {
  /** Master switch — off silences everything (web/desktop toasts AND native push
   *  topic subscriptions). */
  enabled: boolean;
  /** Decrypt the latest message and show its text in the notification (web/desktop
   *  only — native banners are rendered by the OS from the generic FCM payload).
   *  Off keeps the privacy-preserving generic "New message" body. */
  preview: boolean;
  /** Play a sound with the notification (web/desktop: the toast isn't silent). */
  sound: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  preview: false,
  sound: true,
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
  const pick = (k: keyof NotificationSettings) =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_NOTIFICATION_SETTINGS[k];
  return { enabled: pick('enabled'), preview: pick('preview'), sound: pick('sound') };
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
