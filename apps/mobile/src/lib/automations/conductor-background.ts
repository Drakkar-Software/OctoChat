/**
 * OS-wake bridge for automations — web/default no-op.
 *
 * The web/PWA build has no OS background scheduler, so scheduled automations there run only
 * while the page is alive (Conductor's Web engine timers + the foreground driver). These
 * no-ops let `use-automation-background` import unconditionally; the real implementation is
 * `conductor-background.native.ts`, which Metro resolves on iOS/Android. Importing this
 * module on web is intentionally inert (no `expo-task-manager` task is defined) — that also
 * keeps the native-only `expo-conductor/task-manager` peer dep out of the web bundle.
 */

/** Register the OS wake. No-op on web. */
export function registerAutomationWake(): Promise<void> {
  return Promise.resolve();
}

/** Unregister the OS wake. No-op on web. */
export function unregisterAutomationWake(): Promise<void> {
  return Promise.resolve();
}
