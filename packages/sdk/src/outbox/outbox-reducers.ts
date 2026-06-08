/**
 * Pure reducers over the offline outbox's {@link OutboxMessage}[] — the headless half
 * of the app's outbox store. No UI-framework dependency, so they can be unit-tested and
 * reused by any host; the zustand store, kv write-through and React bindings stay in the
 * app (a UI-framework concern).
 */
import type { OutboxMessage } from './outbox-types';

/** A crash/reload can leave an entry stuck `sending` (claimed but never resolved).
 *  Reset those to `queued` on hydrate so the flusher re-attempts them. */
export function resetSendingToQueued(items: OutboxMessage[]): OutboxMessage[] {
  return items.map((i) => (i.status === 'sending' ? { ...i, status: 'queued' as const } : i));
}

/** Pending entries for one (roomId, parentId) surface — top-level when `parentId`
 *  is undefined, a specific thread otherwise. Order preserved (append = ts order). */
export function filterPending(items: OutboxMessage[], roomId: string, parentId?: string): OutboxMessage[] {
  return items.filter((i) => i.roomId === roomId && (i.parentId ?? undefined) === (parentId ?? undefined));
}
