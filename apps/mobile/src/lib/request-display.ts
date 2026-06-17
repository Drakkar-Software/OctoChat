/**
 * Display helpers for inbound ticket requests (the manual "Requests" shelf). Pure + unit-tested
 * so the row component stays declarative.
 */
import type { PendingRequest } from '@drakkar.software/octochat-sdk';

/**
 * The requester's display name + short id for a request row. Prefers the app-supplied label
 * (`meta.requester`, e.g. an email) when it's a non-blank string; otherwise falls back to a
 * short slice of the requester's cryptographic id.
 */
export function requesterDisplay(req: PendingRequest['req']): { who: string; shortId: string } {
  const shortId = `${req.requester.userId.slice(0, 8)}…`;
  const label = req.meta?.requester;
  const who = typeof label === 'string' && label.trim() ? label.trim() : shortId;
  return { who, shortId };
}
