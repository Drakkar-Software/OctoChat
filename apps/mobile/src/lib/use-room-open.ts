/**
 * Shared room-open state machine for {@link ./use-room} (merge-doc) and
 * {@link ./use-stream-room} (append-only). Both open a room the same way — resolve the
 * crypto context over the network, which can fail — so they share ONE policy here for:
 *  - `opening` / `openError` / `offline` flags,
 *  - classifying a failed open: a genuine {@link SpaceAccessError} is a hard
 *    `openError` the user must see; anything else is a connectivity failure that
 *    degrades to an `offline` shell (banner + pending bubbles still render),
 *  - correcting the global online signal from the REAL open outcome
 *    ({@link reportReachability}) so the offline banner shows even when the native
 *    SSE-proxy flag is stuck optimistic-true,
 *  - re-opening automatically when connectivity returns (so a message the outbox
 *    flusher sent while we were offline gets pulled into the live store).
 *
 * The hook owns no crypto/network — the caller runs its own open effect and reports
 * the result via {@link RoomOpenState.beginOpen}/`openReached`/`finishOpening`/`failOpen`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { reportReachability, subscribeOnline } from './connectivity';
import { SpaceAccessError } from './starfish/space-encryptor';

export interface RoomOpenState {
  opening: boolean;
  /** A hard, user-facing error (genuine access denial) — not connectivity. */
  openError: string | null;
  /** The open couldn't reach the server: degrade to an offline shell, don't error. */
  offline: boolean;
  /** Bumped to re-run the caller's open effect (manual retry or reconnect). */
  reloadNonce: number;
  reload: () => void;
  /** Call at the START of an open attempt — resets error/offline, sets `opening`. */
  beginOpen: () => void;
  /** A network-touching open step succeeded — the server is reachable. */
  openReached: () => void;
  /** End the `opening` phase (success). Public-space opens that did no network call
   *  use this WITHOUT {@link openReached}, since they proved nothing about reachability. */
  finishOpening: () => void;
  /** Classify + record a failed open (access denial → error, else offline). */
  failOpen: (e: unknown) => void;
}

export function useRoomOpenState(): RoomOpenState {
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  // Bumped by `reload()` to re-run the caller's open effect after a timeout/error
  // without leaving the screen (the rejected pull already cleared the encryptor cache).
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  // Re-open automatically when connectivity returns, but only if we degraded offline
  // (so a normal online edge doesn't churn a healthy room). A ref keeps the subscriber
  // stable while reading the latest `offline`.
  const offlineRef = useRef(false);
  offlineRef.current = offline;
  useEffect(() => subscribeOnline((on) => { if (on && offlineRef.current) reload(); }), [reload]);

  const beginOpen = useCallback(() => {
    setOpenError(null);
    setOffline(false);
    setOpening(true);
  }, []);
  const openReached = useCallback(() => reportReachability(true), []);
  const finishOpening = useCallback(() => setOpening(false), []);
  const failOpen = useCallback((e: unknown) => {
    if (e instanceof SpaceAccessError) setOpenError(String(e.message));
    else {
      setOffline(true);
      reportReachability(false);
    }
    setOpening(false);
  }, []);

  return { opening, openError, offline, reloadNonce, reload, beginOpen, openReached, finishOpening, failOpen };
}
