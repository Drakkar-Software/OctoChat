/**
 * Drives Conductor's automation scheduling for the active session. Mounted once under the
 * session provider: on a ready session it registers the native OS-wake bridge and reconciles
 * one Conductor task per automated room this device runs; on sign-out it cancels them.
 *
 * The tick HANDLER is defined at module scope via the side-effect import of `conductor-init`
 * in `_layout.tsx` — this hook only reconciles the task set and the OS wake. Re-syncing after
 * an automation is created/edited/deleted happens at those call sites (the settings sheet /
 * creator), which already hold the session.
 */
import { useEffect } from 'react';
import { InteractionManager } from 'react-native';

import { useSession } from '../session-context';

import { cancelAllAutomationTasks, syncAutomationTasks } from './conductor-init';
import { registerAutomationWake, unregisterAutomationWake } from './conductor-background';

export function useAutomationBackground(): void {
  const { session } = useSession();
  useEffect(() => {
    if (!session) return;
    // Register the OS-wake bridge immediately (cheap native call).
    void registerAutomationWake();
    // Defer the reconcile pass until after the first frame so the rail + rooms
    // skeleton paints before the per-space objindex fan-out starts. The headless
    // tick path (handleTick / Conductor.defineTask) is untouched — it runs on
    // cold background wakes where React never mounts and must stay immediate.
    // Capture the handle so a fast session switch cancels a pending reconcile
    // instead of scheduling tasks for the old session after cleanup ran.
    const handle = InteractionManager.runAfterInteractions(() => {
      void syncAutomationTasks(session);
    });
    return () => {
      handle.cancel();
      void cancelAllAutomationTasks();
      void unregisterAutomationWake();
    };
  }, [session]);
}
