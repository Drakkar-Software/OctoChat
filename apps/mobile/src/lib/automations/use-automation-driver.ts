/**
 * Foreground tick driver for ONE automated room. Mounted by the room screen
 * when `kind === 'automated'`:
 *   - Fires an opportunistic scheduled tick on focus + on AppState=active.
 *   - Re-checks every 60 s while the screen is foreground.
 *   - All checks gated by `isDueForScheduledTick` so a non-running device,
 *     a disabled automation, or a too-recent run is a cheap no-op.
 *
 * Background-task wiring (`expo-task-manager` + `expo-background-task`) is a
 * follow-up — this hook delivers the foreground half v1 needs.
 */
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import type { Session } from '../starfish/identity';
import type { Room } from '../types';

import { runAutomationTick } from './orchestrator';
import { isDueForScheduledTick } from './runner-core';

export function useAutomationDriver(opts: { session: Session | null; room: Room | null }) {
  const { session, room } = opts;

  const maybeTick = useCallback(async () => {
    if (!session || !room || !room.automation) return;
    const now = Date.now();
    if (!isDueForScheduledTick(room, session.keys.edPub, now)) return;
    await runAutomationTick({ session, room, trigger: 'scheduled', now });
  }, [session, room]);

  useFocusEffect(
    useCallback(() => {
      void maybeTick();
    }, [maybeTick]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybeTick();
    });
    return () => sub.remove();
  }, [maybeTick]);

  useEffect(() => {
    if (!session || !room) return;
    const id = setInterval(() => void maybeTick(), 60_000);
    return () => clearInterval(id);
  }, [session, room, maybeTick]);
}
