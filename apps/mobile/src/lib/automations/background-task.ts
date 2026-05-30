/**
 * OS background-task driver for automations — web/default no-op implementation.
 *
 * The web/PWA build has no OS background scheduler (`expo-background-task` reports
 * `Restricted` on web), so scheduled automations there run only while their room is
 * open (the foreground `useAutomationDriver`). These no-ops let cross-platform code
 * (`use-automation-background`) import unconditionally — the real implementation is
 * `background-task.native.ts`, which Metro resolves on iOS/Android. Importing this
 * module for its side effect is intentionally inert on web (no task is defined).
 */

/** Register the background automation task. No-op on web. */
export function registerAutomationTask(): Promise<void> {
  return Promise.resolve();
}

/** Unregister the background automation task. No-op on web. */
export function unregisterAutomationTask(): Promise<void> {
  return Promise.resolve();
}
