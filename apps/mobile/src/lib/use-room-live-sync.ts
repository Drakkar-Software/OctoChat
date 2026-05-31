/**
 * Live-update choreography for a room screen, shared by {@link ./use-room} and
 * {@link ./use-stream-room} so the two never drift (that drift is what stale-badged
 * thread replies). It does three things, all gated on `ready` (the store — and for
 * streams, the client — having resolved):
 *  - pull once on focus, and register a pull on the global SSE bus so new messages
 *    arrive live WHILE the room is open. Registering ONLY while focused is load-bearing
 *    for the unread badge: a room left mounted under a pushed screen must release its
 *    registration, or UnreadProvider keeps treating it as active and silently pulls its
 *    change-events instead of bumping unread. On blur the cleanup unregisters.
 *  - poll every 4 s as a fallback, but ONLY while the SSE stream is down.
 *  - skip the duplicate first-focus pull for a self-pulling store (see `skipFirstFocus`).
 *
 * `pull`/`onIdle` are read through refs, so a call site can pass an inline lambda (e.g. a
 * void-wrapped async pull) without re-registering the SSE pull on every render. The focus
 * effect re-runs only on `ready`/`roomId`/`firstFocusKey` change — matching the per-store
 * behavior of the hand-rolled versions this replaced.
 *
 * MUST be called from a router screen — `useFocusEffect` needs a navigator context.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { registerPull, onSseStatus } from './room-events-bus';

export function useRoomLiveSync(opts: {
  roomId: string;
  /** Everything resolved (store present; streams also require the client). */
  ready: boolean;
  /** The already-wrapped, void-returning pull. */
  pull: () => void;
  /** Skip the pull on the FIRST focus after a NEW store — a merge-doc SDK store
   *  self-pulls on creation, so pulling again on first focus is redundant. Keyed on
   *  `firstFocusKey` (pass the store OBJECT) so a same-room reopen — same id, new store
   *  — also skips its own init-pull's first focus. Stream rooms pass `false` (their
   *  synthetic store has no self-pull, so they need the first-focus pull). */
  skipFirstFocus?: boolean;
  firstFocusKey?: unknown;
  /** Runs when not `ready` (e.g. clear the sync-error banner before a store exists). */
  onIdle?: () => void;
}): void {
  const { roomId, ready, pull, skipFirstFocus = false, firstFocusKey, onIdle } = opts;

  // Track the global SSE stream's health for the fallback poll. Always on (even while
  // backgrounded) so the poll's gate stays accurate.
  const [sseUp, setSseUp] = useState(false);
  useEffect(() => onSseStatus(setSseUp), []);

  // Latest pull/onIdle, read by the discrete-event callbacks below so their identity
  // stays stable across renders (an inline `() => void pull()` at the call site would
  // otherwise re-register the SSE pull / re-fire focus every render).
  const pullRef = useRef(pull);
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    pullRef.current = pull;
    onIdleRef.current = onIdle;
  });

  const firstFocusRef = useRef<unknown>(null);
  useFocusEffect(
    useCallback(() => {
      if (!ready) {
        onIdleRef.current?.();
        return;
      }
      if (skipFirstFocus && firstFocusRef.current !== firstFocusKey) {
        firstFocusRef.current = firstFocusKey; // first focus of a fresh self-pulling store
      } else {
        pullRef.current();
      }
      return registerPull(roomId, () => pullRef.current());
    }, [ready, roomId, skipFirstFocus, firstFocusKey]),
  );

  useEffect(() => {
    if (!ready || sseUp) return;
    const id = setInterval(() => pullRef.current(), 4000);
    return () => clearInterval(id);
  }, [ready, sseUp]);
}
