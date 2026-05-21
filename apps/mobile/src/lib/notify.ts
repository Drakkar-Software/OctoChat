/**
 * Web browser notifications for new messages in rooms you're not viewing,
 * driven by the SSE stream. Web-only by design: no-ops on native (no global
 * `Notification`) — mobile push will be delivered via Firebase later.
 *
 * Fires only when the app isn't focused, so it never pops while you're looking
 * at OctoChat (the unread badge already covers that). Content is generic: chat
 * is E2E-encrypted, so the SSE event carries no message text or author.
 */
export function ensureNotifyPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {});
  }
}

export function notifyNewMessage(body = 'New message in another room'): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // Don't notify while the user is actively looking at the app.
  if (typeof document !== 'undefined' && document.hasFocus()) return;
  try {
    new Notification('OctoChat', { body, tag: 'octochat-message' });
  } catch {
    /* notifications unavailable — ignore */
  }
}
