/**
 * Web browser notifications for new messages in rooms you're not viewing,
 * driven by the SSE stream. Web-only by design: no-ops on native (no global
 * `Notification`) — mobile push is delivered via Firebase (see `push/fcm.native`).
 * In the desktop (Electron) app these HTML5 notifications are bridged to native OS
 * toasts by Chromium, so the same code path covers web and desktop.
 *
 * Fires only when the app isn't focused, so it never pops while you're looking
 * at OctoChat (the unread badge already covers that). Content is generic by
 * default — chat is E2E-encrypted, so the SSE event carries no message text — but
 * with the `preview` setting on we decrypt the latest message locally and show it
 * (see `notification-preview.ts`).
 *
 * Clicking a toast focuses the desktop window (via the `window.octochat` bridge,
 * a no-op on web) and navigates to the room that changed.
 */
import { router } from 'expo-router';

import { focusDesktopWindow } from './desktop';
import {
  openRoomFromNotification,
  type OpenRoomFromNotificationDeps,
} from './notification-open-room';
import { getNotificationSettings } from './notification-settings';
import { loadLatestMessagePreview } from './notification-preview';
import type { Session } from './starfish/identity';

const GENERIC_BODY = 'New message in another room';

export function ensureNotifyPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {});
  }
}

interface NotifyOptions {
  /** When true the toast is shown without a sound. */
  silent?: boolean;
  /**
   * Registry/space deps for resolving the clicked room's real name/kind and
   * focusing its space (see `openRoomFromNotification`). When omitted the click
   * falls back to a bare `router.push({ id })` — never worse than before.
   */
  nav?: OpenRoomFromNotificationDeps;
}

export function notifyNewMessage(roomId: string, body = GENERIC_BODY, options: NotifyOptions = {}): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // Don't notify while the user is actively looking at the app.
  if (typeof document !== 'undefined' && document.hasFocus()) return;
  try {
    // Per-room tag so each room's latest toast stays distinct and clickable
    // (a single shared tag would collapse them all into one).
    const n = new Notification('OctoChat', {
      body,
      tag: `octochat-message-${roomId}`,
      silent: options.silent,
    });
    n.onclick = () => {
      focusDesktopWindow(); // no-op on web; brings the Electron window forward
      // Resolve name/kind + focus the space when deps are wired (same path as the
      // native FCM tap); otherwise degrade to opening by bare id.
      if (options.nav) void openRoomFromNotification({ roomId }, options.nav);
      else router.push({ pathname: '/room/[id]', params: { id: roomId } });
    };
  } catch {
    /* notifications unavailable — ignore */
  }
}

/**
 * Notify about a room change, honoring the user's notification settings: skips
 * entirely when disabled, decrypts a message preview when `preview` is on, and
 * mutes the sound when `sound` is off. The async preview fetch is skipped unless
 * a toast will actually be shown (granted + unfocused), so a disabled or
 * background-suppressed notification never triggers a needless pull + decrypt.
 */
export async function notifyRoomChange(
  session: Session | null,
  roomId: string,
  nav?: OpenRoomFromNotificationDeps,
): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.enabled) return;
  // Bail before the (async) preview fetch when no toast could be shown anyway.
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.hasFocus()) return;

  let body = GENERIC_BODY;
  if (settings.preview && session) {
    const preview = await loadLatestMessagePreview(session, roomId).catch(() => null);
    if (preview) body = preview;
  }
  notifyNewMessage(roomId, body, { silent: !settings.sound, nav });
}
