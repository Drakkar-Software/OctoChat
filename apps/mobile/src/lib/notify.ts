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

import { focusDesktopWindow, isDesktop } from './desktop';
import { notificationTitle } from '@drakkar.software/octochat-sdk';
import { activeVariant } from './variants';
import { playNotificationSound } from './notification-sound';
import type { NotificationSound } from './notification-settings';
import {
  openRoomFromNotification,
  type OpenRoomFromNotificationDeps,
} from './notification-open-room';
import { isMuted } from '@drakkar.software/octochat-sdk';
import { getNotificationSettings } from './notification-settings';
import { loadLatestMessagePreview } from '@drakkar.software/octochat-sdk';
import type { Session } from '@drakkar.software/octochat-sdk';
import { spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';

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
  /** Desktop only: which chime to synthesize (ignored when `silent`). */
  soundName?: NotificationSound;
  /** Toast title — the resolved "Space › #room" header; defaults to the app name. */
  title?: string;
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
    // On desktop the toast sound is unreliable (Chromium's Windows toast often
    // shows but stays silent), and the HTML5 API can't pick a sound anyway. So
    // there we fire the toast *silent* and synthesize our own selectable chime
    // (see `notification-sound.ts`); on plain web the OS toast sound is fine, so
    // we keep driving it with the `silent` flag.
    const desktop = isDesktop();
    const n = new Notification(options.title ?? activeVariant.appName, {
      body,
      tag: `octochat-message-${roomId}`,
      renotify: true,
      silent: desktop ? true : options.silent,
    } as NotificationOptions & { renotify: boolean });
    if (desktop && !options.silent) playNotificationSound(options.soundName ?? 'ping');
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
  // Silenced when the room (or its whole space) is muted. The SSE callback already
  // gates this, but the check here keeps the module self-contained for any caller.
  if (isMuted(roomId, spaceIdFromRoomId(roomId))) return;
  // Bail before the (async) preview fetch when no toast could be shown anyway.
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.hasFocus()) return;

  // Resolve the "Space › #room" title from the already-loaded rooms-registry cache
  // (no extra pull — `nav.ensure` shares the same cache the rails read). Best-effort:
  // unresolved names degrade to the bare app name. Names are plaintext metadata, so
  // the title carries them even when `preview` is off and the body stays generic.
  let title: string | undefined;
  if (nav) {
    const entry = await nav.ensure(spaceIdFromRoomId(roomId)).catch(() => null);
    if (entry) {
      const room = entry.rooms.find((r) => r.id === roomId);
      title = notificationTitle(entry.name, room?.name ?? null, room?.kind);
    }
  }

  let body = GENERIC_BODY;
  if (settings.preview && session) {
    const preview = await loadLatestMessagePreview(session, roomId).catch(() => null);
    if (preview) body = preview;
  }
  notifyNewMessage(roomId, body, { silent: !settings.sound, soundName: settings.soundName, nav, title });
}
