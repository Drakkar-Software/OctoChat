/**
 * OS background-task driver for automations — native (iOS / Android).
 *
 * The foreground `useAutomationDriver` only ticks the ONE automated room currently
 * open on screen. This headless task closes that gap: the OS wakes the app
 * periodically (iOS `BGTaskScheduler`, Android `WorkManager`) and we tick every
 * automated room this device is the elected runner for and that is due — even with
 * the app backgrounded or force-quit.
 *
 * `defineTask` MUST run at module scope on EVERY launch, including a cold headless
 * background launch where React never mounts. It is therefore pulled in by a bare
 * side-effect import at the app entry (`src/app/_layout.tsx`), NOT by the register
 * hook — on a background relaunch that hook never runs.
 *
 * The whole tick chain (`sessionFromPersisted` → `readPublicRooms` → `runAutomationTick`)
 * is headless-safe: plain async fns, no hooks/context. We rehydrate the SDK platform
 * and the joined public-space link caps exactly as the FCM background handler does
 * (`push/background-notify.native`), since no provider tree ran in a cold task.
 *
 * Limits (surfaced honestly in the automation UI): intervals are best-effort — iOS
 * schedules opportunistically (often only in overnight windows) and both platforms
 * floor the wake cadence at ~15 min; nothing runs while the device is powered off or
 * (because the seed vault stays `WHEN_UNLOCKED`) while it is locked. A short iOS
 * window may also truncate the loop — remaining rooms simply tick on the next wake.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { configureStarfishPlatform } from '../starfish/platform';
import { initOctoChat } from '../octochat-init';
import {
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  readPublicRooms,
} from '@drakkar.software/octochat-sdk';
import { hydratePubspaceCaps } from '@drakkar.software/octochat-sdk';
import { readSpaces } from '@drakkar.software/octochat-sdk';
import { activeAccountOf, sessionFromPersisted } from '@drakkar.software/octochat-sdk';
import { loadVault } from '../starfish/storage';

import { runAutomationTick } from '@drakkar.software/octochat-sdk';
import { isDueForScheduledTick } from '@drakkar.software/octochat-sdk';

/** Stable identifier the OS schedules this task under. */
export const AUTOMATION_TASK = 'octochat.automations.tick';

/** Inexact wake cadence in minutes. The OS floors this (~15 min) and runs
 *  opportunistically; the per-room `intervalMin` is still enforced by
 *  `isDueForScheduledTick`, so this only sets how often we WAKE to check. */
const MINIMUM_INTERVAL_MIN = 15;

TaskManager.defineTask(AUTOMATION_TASK, async () => {
  try {
    // Install platform crypto/base64 the SDK needs AND wire the SDK to this app's
    // config + kv — no provider tree ran in this headless task, so `_layout`'s boot
    // init never executed. Both are idempotent. Mirrors the FCM background handler.
    configureStarfishPlatform();
    initOctoChat();

    const load = await loadVault();
    if (load.kind !== 'ready') return BackgroundTask.BackgroundTaskResult.Success; // signed out / locked
    const account = activeAccountOf(load.vault);
    if (!account?.derived?.userId) return BackgroundTask.BackgroundTaskResult.Success;

    const session = await sessionFromPersisted(account);
    // Joined public-space link caps live only in kv on a cold launch — rehydrate so a
    // JOINED public space can authorize its plaintext registry pull (owned public
    // spaces use the account cap, no entry needed).
    await hydratePubspaceCaps(session.userId);

    const now = Date.now();
    const { spaces } = await readSpaces(session.accountClient, session.userId);
    for (const space of spaces) {
      // Automations are public-space-only — owned or joined.
      if (!isPublicSpaceId(space.id)) continue;
      try {
        const { ownerId } = publicSpaceAuth(session, space.id);
        const client = publicSpaceClient(session, space.id);
        const rooms = await readPublicRooms(client, ownerId, space.id);
        for (const room of rooms) {
          if (!room.automation) continue;
          // `onOpen` automations fire on an in-app open event (focus / AppState-active);
          // a headless wake has no "open", so running them here would turn "on open" into
          // "every ~15 min in the background". Skip them — timed cadences only.
          if (room.automation.onOpen) continue;
          // Gate enforces enabled + this device is the elected runner + intervalMin > 0
          // + elapsed since lastRunAt — a cheap no-op otherwise.
          if (!isDueForScheduledTick(room, session.keys.edPub, now)) continue;
          await runAutomationTick({ session, room, trigger: 'scheduled', now });
        }
      } catch (e) {
        // One unreachable/unauthorized space must not abort the others.
        console.error('[automations] background tick failed for space', space.id, e);
      }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.error('[automations] background task failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the periodic background task. No-op when the OS reports it restricted
 *  (e.g. Low Power Mode, or web). Idempotent — safe to call on every session start. */
export async function registerAutomationTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    await BackgroundTask.registerTaskAsync(AUTOMATION_TASK, {
      minimumInterval: MINIMUM_INTERVAL_MIN,
    });
  } catch (e) {
    console.error('[automations] failed to register background task', e);
  }
}

/** Unregister the background task (on sign-out). Best-effort. */
export async function unregisterAutomationTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(AUTOMATION_TASK)) {
      await BackgroundTask.unregisterTaskAsync(AUTOMATION_TASK);
    }
  } catch (e) {
    console.error('[automations] failed to unregister background task', e);
  }
}
