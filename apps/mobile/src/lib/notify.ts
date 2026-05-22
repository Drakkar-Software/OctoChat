/**
 * Web browser notifications for new messages in rooms you're not viewing,
 * driven by the SSE stream. Web-only by design: no-ops on native (no global
 * `Notification`) — mobile push will be delivered via Firebase later. In the
 * desktop (Electron) app these HTML5 notifications are bridged to native OS
 * toasts by Chromium, so the same code path covers web and desktop.
 *
 * Fires only when the app isn't focused, so it never pops while you're looking
 * at OctoChat (the unread badge already covers that). Content is generic: chat
 * is E2E-encrypted, so the SSE event carries no message text or author.
 *
 * Clicking a toast focuses the desktop window (via the `window.octochat` bridge,
 * a no-op on web) and navigates to the room that changed.
 */
import { router } from 'expo-router';

import { focusDesktopWindow } from './desktop';

export function ensureNotifyPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {});
  }
}

export function notifyNewMessage(
  roomId: string,
  body = 'New message in another room',
): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // Don't notify while the user is actively looking at the app.
  if (typeof document !== 'undefined' && document.hasFocus()) return;
  try {
    // Per-room tag so each room's latest toast stays distinct and clickable
    // (a single shared tag would collapse them all into one).
    const n = new Notification('OctoChat', { body, tag: `octochat-message-${roomId}` });
    n.onclick = () => {
      focusDesktopWindow(); // no-op on web; brings the Electron window forward
      router.push({ pathname: '/room/[id]', params: { id: roomId } });
    };
  } catch {
    /* notifications unavailable — ignore */
  }
}
