/**
 * Online/offline signal — NATIVE (iOS/Android). Dependency-free: rather than add
 * `@react-native-community/netinfo` (a native module ⇒ rebuild + app-version bump),
 * we proxy server reachability off the SHARED SSE connection's health
 * (`onSseStatus` from {@link ./room-events-bus}). SSE up ⇒ the server is reachable.
 *
 * Two refinements over a raw mirror of `sseUp`:
 *  - Start OPTIMISTIC (`true`) — a fresh launch shouldn't flash "offline" before the
 *    stream has had a chance to connect.
 *  - DEBOUNCE the down edge: SSE momentarily drops on reconnects (and the deployed
 *    bridge is known to reconnect-loop), so only treat the device as offline after
 *    the stream has stayed down past {@link OFFLINE_GRACE_MS}. The up edge is
 *    applied immediately.
 *
 * Like the web variant, this only powers the composer hint + the flusher's retry
 * trigger — sending is attempt-driven, so a wrong boolean never loses a message.
 */
import { useEffect, useState } from 'react';

import { onSseStatus } from './room-events-bus';

const OFFLINE_GRACE_MS = 5000;

let online = true;
const listeners = new Set<(v: boolean) => void>();
let downTimer: ReturnType<typeof setTimeout> | null = null;

function set(v: boolean): void {
  if (v === online) return;
  online = v;
  for (const l of listeners) l(v);
}

onSseStatus((up) => {
  if (downTimer) {
    clearTimeout(downTimer);
    downTimer = null;
  }
  if (up) set(true);
  else downTimer = setTimeout(() => set(false), OFFLINE_GRACE_MS);
});

/** Current best-effort online state. */
export function getOnline(): boolean {
  return online;
}

/** Subscribe to online-state CHANGES (not fired immediately). Returns an unsubscribe. */
export function subscribeOnline(cb: (online: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React binding for {@link getOnline}/{@link subscribeOnline}. */
export function useOnline(): boolean {
  const [v, setV] = useState(getOnline);
  useEffect(() => subscribeOnline(setV), []);
  return v;
}
