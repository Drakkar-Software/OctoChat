/**
 * Global outbox flusher — the background worker that actually drains the offline
 * {@link ./outbox}. Mounted once at the root (it needs only the session), so a
 * queued message goes out as soon as the device is back online EVEN IF the user has
 * navigated away from the room or just relaunched the app — that's what makes the
 * promise "sent when you reconnect" hold, not merely "sent when you reopen the room".
 *
 * It also hydrates the active identity's persisted queue (and clears it on sign-out).
 *
 * Drain policy (attempt-driven, see outbox.ts):
 *  - Truly attempt-driven. `getOnline()` only gates the ENQUEUE-triggered drain (so a
 *    genuinely-offline message reads "will send when online", not "failed", and we
 *    don't fire a doomed request). The reconnect edges and the interval drain
 *    REGARDLESS of `getOnline()` — on native that flag is just an SSE-reachability
 *    proxy, and the deployed bridge can reconnect-loop while REST is fine, so a
 *    hard online gate would strand the queue. `sendQueued` is the real arbiter.
 *  - Each entry is `claim`ed before sending so the same id is never sent twice.
 *  - Confirmed send ⇒ `remove`. A thrown send while we believed we were online ⇒
 *    `recordFailure` (escalates to `failed` only after MAX_ATTEMPTS — manual retry);
 *    a throw while offline ⇒ `retry` (stays `queued`, no escalation).
 *  - NEVER flushes a queue under the wrong identity: each iteration re-checks that the
 *    store is hydrated for the live session (account-switch is async — see below).
 *  - Triggered on: reconnect (online + SSE-up edges), a fresh enqueue, the queue being
 *    (re)hydrated for a new account, app mount, and a slow interval.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { getOnline, reportReachability, subscribeOnline } from './connectivity';
import { outboxStore, useOutboxHydration } from './outbox';
import { sendQueued } from './outbox-send';
import { dispatchRoomChange, onSseStatus } from './room-events-bus';
import { useSession } from './session-context';
import type { Session } from './starfish/identity';

const RETRY_INTERVAL_MS = 20000;
/** Online send attempts before an entry is parked as `failed` (manual retry). An
 *  offline failure never counts toward this — it just stays `queued`. */
const MAX_ATTEMPTS = 5;

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  // Load this identity's persisted queue on sign-in / switch; clear on sign-out.
  useOutboxHydration(session?.userId ?? null);

  // Latest session for the async drain loop without re-creating it each render.
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  // Single-flight guard + a "run again" flag so an enqueue/trigger arriving mid-drain
  // is not dropped.
  const runningRef = useRef(false);
  const rerunRef = useRef(false);

  // `force` skips the online-proxy gate (reconnect edges + interval — let the real
  // request decide). `includeFailed` also re-attempts parked `failed` entries.
  const drain = useCallback(async (opts: { includeFailed: boolean; force: boolean }): Promise<void> => {
    const { includeFailed, force } = opts;
    if (!force && !getOnline()) return;
    if (!sessionRef.current) return;
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    runningRef.current = true;
    try {
      do {
        rerunRef.current = false;
        const session = sessionRef.current;
        if (!session) break;
        // Account switch is async (hydrate('B') resolves after this effect runs): never
        // flush A's queued items under B's session — wait until the store is hydrated
        // for the live identity (a userId-change subscribe trigger re-drains then).
        if (outboxStore.getState().userId !== session.userId) break;
        const items = outboxStore
          .getState()
          .items.filter((i) => i.status === 'queued' || (includeFailed && i.status === 'failed'));
        for (const it of items) {
          if (!force && !getOnline()) break; // dropped offline mid-drain — leave the rest queued
          if (outboxStore.getState().userId !== session.userId) break; // identity swapped mid-drain
          if (!outboxStore.getState().claim(it.id)) continue; // already in flight
          try {
            await sendQueued(session, it);
            // A confirmed send PROVES the server is reachable — flip the online signal
            // true (it may be stuck false: the native flag is an SSE proxy, and the
            // deployed bridge can reconnect-loop while REST is fine). This is what makes
            // a room the user opened OFFLINE recover: the open hook's reconnect watcher
            // re-opens over REST and pulls in this very message. Without it, the entry is
            // removed here but the offline room's empty fallback store never refreshes,
            // so the message would vanish until manual re-entry.
            reportReachability(true);
            outboxStore.getState().remove(it.id);
            // If the room is already open with a live store, pull now so the real (synced)
            // message replaces the pending bubble without waiting for the next SSE tick.
            dispatchRoomChange(it.roomId);
          } catch {
            // Believed-online failure escalates toward `failed`; an offline blip just
            // re-queues (no escalation) so it keeps reading "will send when online".
            if (getOnline()) outboxStore.getState().recordFailure(it.id, MAX_ATTEMPTS);
            else outboxStore.getState().retry(it.id);
          }
        }
      } while (rerunRef.current);
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void drain({ includeFailed: true, force: true }); // catch up on launch/switch
    const offOnline = subscribeOnline((on) => {
      if (on) void drain({ includeFailed: true, force: true });
    });
    const offSse = onSseStatus((up) => {
      if (up) void drain({ includeFailed: true, force: true });
    });
    const offStore = outboxStore.subscribe((s, prev) => {
      // A fresh enqueue grows the queue → send it now (gated on online so a genuinely
      // offline message stays "queued"). A userId change = this account's queue just
      // hydrated → catch it up (force, since reconnect edges may have fired pre-hydrate).
      if (s.userId !== prev.userId) void drain({ includeFailed: true, force: true });
      else if (s.items.length > prev.items.length) void drain({ includeFailed: false, force: false });
    });
    const iv = setInterval(() => void drain({ includeFailed: true, force: true }), RETRY_INTERVAL_MS);
    return () => {
      offOnline();
      offSse();
      offStore();
      clearInterval(iv);
    };
  }, [session, drain]);

  return <>{children}</>;
}
