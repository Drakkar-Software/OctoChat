/**
 * Drives the native biometric app-lock overlay (`components/ui/AppLockGate`). Locks the
 * UI when the app truly backgrounds and re-prompts on return; the session is NEVER torn
 * down — this is a screen-lock (the OS already protects the seed at rest), not a vault
 * unlock. Inert on web (see `use-app-lock-gate.ts`).
 *
 * Sharp edges handled deliberately:
 *  - Re-entrancy: the OS biometric sheet itself fires AppState transitions (→ inactive,
 *    and 'active' again on dismiss). A naive handler would relock-prompt in a loop, so
 *    every AppState/back handler short-circuits while a prompt is in flight. `authingRef`
 *    is flipped SYNCHRONOUSLY (not via render) so the guard holds before the sheet's
 *    first transition arrives.
 *  - Transient vs real background: a Control Center pull / notification banner lands on
 *    'inactive' (not 'background'). We cover the snapshot on 'inactive' but only REQUIRE
 *    re-auth when a real 'background' happened — otherwise dismissing Control Center would
 *    nag for biometrics every time.
 *  - Unenforceable lock: if the user turns biometrics off at the OS level after enabling
 *    the lock, a stored flag alone would strand them behind a prompt that can't succeed.
 *    The lock decision re-probes support and AUTO-BYPASSES + clears the flag when gone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, type AppStateStatus } from 'react-native';

import {
  authenticateBiometric,
  biometricLockEnabledSync,
  biometricSupported,
  disableBiometricLock,
  isBiometricLockEnabled,
} from './app-lock';
import type { AppLockGateState } from './use-app-lock-gate';

export type { AppLockGateState } from './use-app-lock-gate';

export function useAppLockGate(): AppLockGateState {
  const [locked, setLocked] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listeners subscribe once; refs let them read live values without re-subscribing.
  const authingRef = useRef(false); // managed manually for a synchronous guard
  const lockedRef = useRef(false);
  const backgroundedRef = useRef(false); // a real 'background' (not a transient 'inactive')
  lockedRef.current = locked;

  // Is the lock enforceable right now: flag on AND biometrics still set up. Reads via the
  // shared module cache (`biometricLockEnabledSync`), so it picks up a settings toggle
  // with no restart. Clears a now-unenforceable flag so gate + settings agree it's off.
  const enforceable = useCallback(async (): Promise<boolean> => {
    const on = await isBiometricLockEnabled();
    if (!on) return false;
    if (await biometricSupported()) return true;
    await disableBiometricLock();
    return false;
  }, []);

  const prompt = useCallback(async () => {
    if (authingRef.current) return;
    authingRef.current = true; // synchronous: blocks the AppState listener before the sheet bounces it
    setAuthing(true);
    setError(null);
    const ok = await authenticateBiometric();
    authingRef.current = false;
    setAuthing(false);
    if (ok) setLocked(false);
    else setError('Authentication failed. Try again.');
  }, []);

  const unlock = useCallback(() => {
    void prompt();
  }, [prompt]);

  // Mount: lock + prompt if the lock is enforceable.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (await enforceable()) {
        if (cancelled) return;
        setLocked(true);
        void prompt();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enforceable, prompt]);

  // Foreground / background transitions.
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = prev === 'active';
      prev = next;
      // The biometric sheet bounces AppState — ignore everything while it's up.
      if (authingRef.current) return;
      if (next === 'background') {
        backgroundedRef.current = true;
        if (biometricLockEnabledSync()) setLocked(true);
      } else if (next === 'inactive' && wasActive) {
        // Cover the app-switcher snapshot. A transient interruption (Control Center,
        // banner) also lands here — it's revealed without a prompt on return below,
        // unless a real 'background' follows.
        if (biometricLockEnabledSync()) setLocked(true);
      } else if (next === 'active') {
        if (!lockedRef.current) {
          backgroundedRef.current = false;
          return;
        }
        const backgrounded = backgroundedRef.current;
        backgroundedRef.current = false;
        if (backgrounded) {
          // Real return-from-background → re-check enforceability and prompt (or
          // auto-bypass if OS biometrics were removed since launch).
          void (async () => {
            if (await enforceable()) void prompt();
            else setLocked(false);
          })();
        } else {
          // Came back from a transient 'inactive' (never backgrounded) → just reveal.
          setLocked(false);
        }
      }
    });
    return () => sub.remove();
  }, [enforceable, prompt]);

  // Swallow the Android hardware back button while locked so it can't pop the navigator
  // or let the user act on the screen behind the overlay.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => lockedRef.current);
    return () => sub.remove();
  }, []);

  return { locked, authing, error, unlock };
}
