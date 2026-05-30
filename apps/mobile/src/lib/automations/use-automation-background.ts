/**
 * Registers the OS background-task that ticks due automations while the app is
 * backgrounded or closed (native only; no-op on web). Mounted once under the
 * session provider: registers when a session is ready, unregisters on sign-out.
 *
 * The task itself is DEFINED at module scope via the side-effect import in
 * `src/app/_layout.tsx` — this hook only registers/unregisters it.
 */
import { useEffect } from 'react';

import { useSession } from '../session-context';

import { registerAutomationTask, unregisterAutomationTask } from './background-task';

export function useAutomationBackground(): void {
  const { session } = useSession();
  useEffect(() => {
    if (!session) return;
    void registerAutomationTask();
    return () => void unregisterAutomationTask();
  }, [session]);
}
