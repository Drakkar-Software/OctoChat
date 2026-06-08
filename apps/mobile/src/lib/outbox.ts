/**
 * Offline outbox — the queue of messages the user composed while a send couldn't
 * reach the server. One unified, persisted, per-message queue across EVERY room
 * kind (channel / dm / private / stream, public or E2EE) and surface (room screen,
 * thread reply) — see {@link ./outbox-send} for how an entry is actually sent and
 * {@link ./outbox-context} for the global flusher that drains it on reconnect.
 *
 * Design invariants:
 *  - **Dedup by id.** An entry's `id` is threaded into the real send (see the `id`
 *    param added to `useRoom`/`useStreamRoom` `send`), so the sent message lands in
 *    the room store under the SAME id. The render merge (see
 *    `mergePendingMessages` in message-view) drops any pending entry whose id is
 *    already in the store — so a flushed entry disappears the instant its message
 *    arrives, with no duplicate and no removal race.
 *  - **Removed only on confirmed success.** The flusher `remove()`s an entry only
 *    after `sendQueued` resolves; a failure leaves it `failed` (tap-to-retry).
 *  - **Persisted per identity.** Keyed `octochat.outbox.v1.<userId>` in the shared
 *    `kv` layer (localStorage web / AsyncStorage native), so a queued message
 *    survives a reload/restart. Like `use-draft`, the queued TEXT is plaintext at
 *    rest in kv — same exposure as the existing drafts there.
 */
import { useEffect, useMemo } from 'react';
import { createStore, useStore } from 'zustand';

import { kvGet, kvSet } from '@drakkar.software/octochat-sdk';
// The message shape AND the pure reducers live in the headless SDK (shared with the
// send path + the render-time merge); the store (a UI-framework concern) stays here.
import type { OutboxMessage } from '@drakkar.software/octochat-sdk';
import { filterPending, resetSendingToQueued } from '@drakkar.software/octochat-sdk';
export type { OutboxMessage, OutboxStatus } from '@drakkar.software/octochat-sdk';
// Re-export so existing `import { filterPending, resetSendingToQueued } from './outbox'`
// call sites keep working now that the reducers' canonical home is the SDK.
export { filterPending, resetSendingToQueued } from '@drakkar.software/octochat-sdk';

const key = (userId: string) => `octochat.outbox.v1.${userId}`;

// ── Store ─────────────────────────────────────────────────────────────────────

interface OutboxStore {
  /** The identity these `items` belong to (guards write-through during a switch). */
  userId: string | null;
  items: OutboxMessage[];
  /** Load this identity's persisted queue (replacing any held items). */
  hydrate: (userId: string) => Promise<void>;
  /** Drop all in-memory state (sign-out). */
  clear: () => void;
  enqueue: (entry: OutboxMessage) => void;
  /** Mark an entry `sending`; returns false if it was already claimed (the room
   *  flush and the global flush can both fire — first claim wins, no double-send). */
  claim: (id: string) => boolean;
  /** Sent successfully — drop it. */
  remove: (id: string) => void;
  /** Send failed — mark it failed and bump attempts. */
  markFailed: (id: string) => void;
  /** A send attempt threw: bump attempts, and only escalate to `failed` once
   *  `maxAttempts` is reached — below that, keep it `queued` so a transient/offline
   *  blip keeps reading "will send when online" and auto-retries (see outbox-context). */
  recordFailure: (id: string, maxAttempts: number) => void;
  /** Re-queue an entry (manual retry of a failed one, or backing a claimed-but-
   *  unsent entry out of `sending`). Leaves `attempts` untouched. */
  retry: (id: string) => void;
}

const store = createStore<OutboxStore>((set, get) => ({
  userId: null,
  items: [],
  hydrate: async (userId) => {
    const raw = await kvGet(key(userId));
    let items: OutboxMessage[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) items = parsed as OutboxMessage[];
      } catch {
        /* corrupt blob → start empty; never brick on bad JSON */
      }
    }
    set({ userId, items: resetSendingToQueued(items) });
  },
  clear: () => set({ userId: null, items: [] }),
  enqueue: (entry) => set({ items: [...get().items, entry] }),
  claim: (id) => {
    const it = get().items.find((i) => i.id === id);
    if (!it || it.status === 'sending') return false;
    set({ items: get().items.map((i) => (i.id === id ? { ...i, status: 'sending' } : i)) });
    return true;
  },
  remove: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
  markFailed: (id) =>
    set({
      items: get().items.map((i) =>
        i.id === id ? { ...i, status: 'failed', attempts: i.attempts + 1 } : i,
      ),
    }),
  recordFailure: (id, maxAttempts) =>
    set({
      items: get().items.map((i) => {
        if (i.id !== id) return i;
        const attempts = i.attempts + 1;
        return { ...i, attempts, status: attempts >= maxAttempts ? 'failed' : 'queued' };
      }),
    }),
  retry: (id) => set({ items: get().items.map((i) => (i.id === id ? { ...i, status: 'queued' } : i)) }),
}));

// Write-through: persist whenever the queue changes, under the active identity.
// Keyed on `userId` set atomically with `items` in hydrate, so a switch never
// writes one account's queue under another's key.
store.subscribe((state, prev) => {
  if (state.items !== prev.items && state.userId) void kvSet(key(state.userId), JSON.stringify(state.items));
});

/** The vanilla store — used by the flusher ({@link ./outbox-context}) outside React. */
export const outboxStore = store;

// ── React bindings ──────────────────────────────────────────────────────────

/** Pending entries for one (roomId, parentId) surface, plus the actions a screen
 *  needs. The `items` selector returns a stable reference until the queue changes,
 *  so the `useMemo` filter only re-runs on a real change. */
export function useOutbox(roomId: string, parentId?: string) {
  const items = useStore(store, (s) => s.items);
  const pending = useMemo(() => filterPending(items, roomId, parentId), [items, roomId, parentId]);
  const enqueue = store.getState().enqueue;
  const retry = store.getState().retry;
  return { pending, enqueue, retry };
}

/** Hydrate the active identity's queue on sign-in / account switch; clear on
 *  sign-out. Mounted once by {@link ./outbox-context}. */
export function useOutboxHydration(userId: string | null): void {
  useEffect(() => {
    if (userId) void store.getState().hydrate(userId);
    else store.getState().clear();
  }, [userId]);
}
