/**
 * Online/offline signal — WEB + DESKTOP (Electron). Native uses
 * `connectivity.native.ts` (an SSE-reachability proxy, no native dep).
 *
 * `navigator.onLine` + the window `online`/`offline` events are authoritative and
 * immediate here. This signal powers the composer's proactive "you're offline"
 * hint and the outbox flusher's retry trigger — it is NEVER the hard gate on
 * sending: the outbox is attempt-driven (try the real send, queue only on a thrown
 * failure), so a momentarily-wrong boolean can't lose a message.
 */
import { useEffect, useState } from 'react';

function nav(): { onLine?: boolean } | undefined {
  return (globalThis as { navigator?: { onLine?: boolean } }).navigator;
}

let online = typeof nav()?.onLine === 'boolean' ? !!nav()!.onLine : true;
const listeners = new Set<(v: boolean) => void>();

function set(v: boolean): void {
  if (v === online) return;
  online = v;
  for (const l of listeners) l(v);
}

const w = (globalThis as { window?: Window }).window;
if (w?.addEventListener) {
  w.addEventListener('online', () => set(true));
  w.addEventListener('offline', () => set(false));
}

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
