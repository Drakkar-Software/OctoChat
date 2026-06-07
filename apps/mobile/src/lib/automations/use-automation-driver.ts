/**
 * Foreground glue for ONE automated room, mounted by the room screen when
 * `kind === 'automated'`. Scheduling itself is owned by Conductor (`conductor-init`);
 * this hook only:
 *   - Reflects a completed tick's `lastRunAt` / `lastError` back into the rooms-registry
 *     cache so the open room's status refreshes immediately (the server write-back in
 *     `runAutomationTick` doesn't refresh the in-memory cache).
 *   - Forces an immediate tick when the screen gains focus, preserving "tick on open":
 *     Conductor's `appState` trigger fires on app-foreground, not per-screen navigation,
 *     and on web the tab is already visible, so opening a room would otherwise not tick.
 *
 * Both are gated so they can't double-act: the focus tick runs only on the elected leader
 * instance (`active`, see leader.ts) and is a cheap no-op when the handler's own
 * enabled/runner/due + content-hash gates say there's nothing to post.
 */
import { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';

import Conductor, { TaskResult } from '@drakkar.software/expo-conductor';

import { useRoomsRegistryActions } from '../rooms-registry-context';
import type { Room, Session } from '@drakkar.software/octochat-sdk';

import { automationTaskId } from './conductor-init';

export function useAutomationDriver(opts: { session: Session | null; room: Room | null; active?: boolean }) {
  const { room, active = true } = opts;
  const { patchRoomAutomationLocal } = useRoomsRegistryActions();
  const spaceId = room?.spaceId;
  const roomId = room?.id;
  const automated = !!room?.automation;

  // Live UI freshness: patch the shared cache when this room's task completes / errors.
  useEffect(() => {
    if (!automated || !spaceId || !roomId) return;
    const taskId = automationTaskId(spaceId, roomId);
    const onComplete = Conductor.addListener('onTaskComplete', (p) => {
      if (p.taskId !== taskId) return;
      // Only a tick that actually ran advanced lastRunAt on the server: NEW_DATA (posted) or
      // SUCCESS (polled, unchanged). NO_DATA means the due-gate skipped it (no write) and
      // FAILED is handled by onTaskError — neither should advance the cached lastRunAt.
      if (p.result !== TaskResult.NEW_DATA && p.result !== TaskResult.SUCCESS) return;
      patchRoomAutomationLocal(spaceId, roomId, { lastRunAt: p.firedAt, lastError: null });
    });
    const onError = Conductor.addListener('onTaskError', (p) => {
      if (p.taskId !== taskId) return;
      patchRoomAutomationLocal(spaceId, roomId, { lastError: p.error });
    });
    return () => {
      onComplete.remove();
      onError.remove();
    };
  }, [automated, spaceId, roomId, patchRoomAutomationLocal]);

  // Force an immediate tick on focus (the open-room "tick on open"). Gated by `active` so
  // two same-account tabs don't both force-tick; a no-op when not due / unchanged, or when
  // this device isn't the runner (the task was never scheduled → runNow finds nothing).
  useFocusEffect(
    useCallback(() => {
      if (!active || !automated || !spaceId || !roomId) return;
      void Conductor.runNow(automationTaskId(spaceId, roomId));
    }, [active, automated, spaceId, roomId]),
  );
}
