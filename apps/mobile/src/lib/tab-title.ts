/**
 * Reflect the unread total in the browser tab title, e.g. "(3) OctoChat".
 * Web/desktop only: no-ops on native, where there is no `document`. Clears back
 * to the bare title once the count returns to zero.
 *
 * The base title (set from `%WEB_TITLE%` in `public/index.html`) is captured on
 * the first call so we can restore it; any stale "(n) " prefix is stripped first
 * to stay correct across hot reloads.
 */
let baseTitle: string | null = null;

export function setTabTitleBadge(n: number): void {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
  document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle;
}
