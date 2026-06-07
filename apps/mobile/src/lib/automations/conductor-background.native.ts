/**
 * Native OS-wake bridge for automations — iOS / Android.
 *
 * Conductor's JS handler registry is in-memory, so a JS handler only runs while the app is
 * alive. This bridge (shipped by the library as `@drakkar.software/expo-conductor/task-manager`)
 * registers ONE `expo-task-manager` task — whose registry the OS can invoke headlessly — that
 * calls `Conductor.runDueTasks()`, firing every due automation task's JS handler even after a
 * cold start. Importing this module runs that `TaskManager.defineTask` at module scope (the
 * `_layout.tsx` side-effect import), which is required for the headless relaunch path.
 *
 * Cadence is best-effort: the OS floors the wake at ~15 min and runs opportunistically;
 * nothing fires while the device is powered off or (seed vault is `WHEN_UNLOCKED`) locked.
 */
import {
  registerConductorBackgroundTask,
  unregisterConductorBackgroundTask,
} from '@drakkar.software/expo-conductor/task-manager';

/** Inexact OS wake cadence in minutes; the OS floors this (~15 min). The per-room
 *  `intervalMin` is still enforced by the handler's due-gate, so this only sets how often
 *  we WAKE to check. */
const MINIMUM_INTERVAL_MIN = 15;

/** Register the periodic OS wake that drives due automation ticks. Idempotent — safe on
 *  every session start. Best-effort: a no-op where the OS reports background restricted. */
export async function registerAutomationWake(): Promise<void> {
  try {
    await registerConductorBackgroundTask({ minimumInterval: MINIMUM_INTERVAL_MIN });
  } catch (e) {
    console.error('[automations] failed to register conductor background wake', e);
  }
}

/** Unregister the OS wake (on sign-out). Best-effort. */
export async function unregisterAutomationWake(): Promise<void> {
  try {
    await unregisterConductorBackgroundTask();
  } catch (e) {
    console.error('[automations] failed to unregister conductor background wake', e);
  }
}
