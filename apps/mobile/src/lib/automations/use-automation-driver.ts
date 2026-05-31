/**
 * Foreground tick driver for ONE automated room. Mounted by the room screen
 * when `kind === 'automated'`:
 *   - Fires an opportunistic scheduled tick on focus + on AppState=active.
 *   - Re-checks every 60 s while the screen is foreground.
 *   - All checks gated by `isDueForScheduledTick` so a non-running device,
 *     a disabled automation, or a too-recent run is a cheap no-op.
 *   - After each tick it reflects `lastRunAt` back into the rooms-registry cache
 *     (`patchRoomAutomationLocal`) so the gate sees the run immediately — the
 *     server write in `runAutomationTick` doesn't refresh the in-memory cache,
 *     so without this a timed automation re-fires on every open.
 *
 * The focus + AppState callbacks are kept stable (they call through a ref) so
 * the re-render caused by the local cache patch can't re-run them — for an
 * "on open" (ungated) automation that would be an infinite tick loop.
 *
 * Background-task wiring (`expo-task-manager` + `expo-background-task`) covers
 * the app-closed case via the same gate.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useRoomsRegistryActions } from '../rooms-registry-context';
import type { Session } from '../starfish/identity';
import type { Room } from '../types';

import { runAutomationTick, tickStatusPatch } from './orchestrator';
import { isDueForScheduledTick } from './runner-core';

export function useAutomationDriver(opts: { session: Session | null; room: Room | null }) {
  const { session, room } = opts;
  const { patchRoomAutomationLocal } = useRoomsRegistryActions();
  const inFlight = useRef(false);

  const maybeTick = useCallback(async () => {
    if (inFlight.current) return; // reentrancy guard — focus + AppState can fire together
    if (!session || !room || !room.automation) return;
    const now = Date.now();
    if (!isDueForScheduledTick(room, session.keys.edPub, now)) return;
    inFlight.current = true;
    try {
      const outcome = await runAutomationTick({ session, room, trigger: 'scheduled', now });
      // Reflect the run into the shared cache so the next gate check sees it
      // (the server write alone leaves the in-memory room stale → re-fires).
      patchRoomAutomationLocal(room.spaceId, room.id, tickStatusPatch(outcome, now));
    } finally {
      inFlight.current = false;
    }
  }, [session, room, patchRoomAutomationLocal]);

  // Stable handle for the discrete-event triggers (focus / AppState). Reading
  // through a ref keeps their callbacks identity-stable, so the re-render from a
  // cache patch can't re-fire them (which, ungated, would loop on "on open").
  const maybeTickRef = useRef(maybeTick);
  useEffect(() => {
    maybeTickRef.current = maybeTick;
  });

  // Keyed on room.id (not `[]`): re-runs when the room loads late (cold deep-link —
  // `room` is null at mount until the registry resolves) or on a room switch, so the
  // first "on open" tick doesn't wait for the 60 s interval. `room.id` is stable across
  // a cache patch, so the optimistic `lastRunAt` update can't re-fire this (no loop).
  useFocusEffect(
    useCallback(() => {
      void maybeTickRef.current();
    }, [room?.id]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybeTickRef.current();
    });
    return () => sub.remove();
  }, []);

  // Periodic re-check for TIMED cadences only — an "on open" automation fires on the
  // open event (focus / AppState-active), not repeatedly while the room sits open.
  useEffect(() => {
    if (!session || !room || room.automation?.onOpen) return;
    const id = setInterval(() => void maybeTick(), 60_000);
    return () => clearInterval(id);
  }, [session, room, maybeTick]);
}
