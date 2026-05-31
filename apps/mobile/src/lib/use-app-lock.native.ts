/**
 * Native variant of {@link useAppLock}: a biometric (Face ID / Touch ID / fingerprint)
 * app-lock toggle for the security card. Mirrors the web passkey control's shape so the
 * shared `AppLockRow` consumes either without branching. See `use-app-lock.ts`.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  biometricLabel,
  biometricSupported,
  disableBiometricLock,
  enableBiometricLock,
  isBiometricLockEnabled,
} from './app-lock';
// Type-only import: erased at build time, so Metro never resolves it back to this
// native file (no runtime cycle); tsc resolves it to the web file's declaration.
import type { AppLockControl } from './use-app-lock';

export type { AppLockControl } from './use-app-lock';

export function useAppLock(): AppLockControl {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [label, setLabel] = useState('biometrics');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, e, l] = await Promise.all([biometricSupported(), isBiometricLockEnabled(), biometricLabel()]);
      if (cancelled) return;
      setSupported(s);
      setEnabled(e);
      setLabel(l);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback((on: boolean) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        if (on) {
          const ok = await enableBiometricLock();
          setEnabled(ok);
          if (!ok) setError('Could not turn on the lock. Check that biometrics are set up on this device.');
        } else {
          await disableBiometricLock();
          setEnabled(false);
        }
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    supported,
    enabled,
    busy,
    error,
    iconName: 'lock',
    title: `Require ${cap}`,
    detail: `Unlock OctoChat with ${label} every time you open it.`,
    toggle,
  };
}
