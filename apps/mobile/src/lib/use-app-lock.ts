/**
 * The security-card "faster unlock" control, abstracted across platforms so one row
 * (`components/settings/AppLockRow`) drives both. On WEB it's a WebAuthn passkey enrolled
 * on the vault (this file); on NATIVE it's device biometrics (`use-app-lock.native.ts`).
 * The component only reads {@link AppLockControl} and never branches on platform itself.
 */
import { useCallback, useState } from 'react';

import type { IconName } from '@/components/ui/Icon';

import { isDesktop } from './desktop';
import { useSession } from './session-context';

export interface AppLockControl {
  /** Whether to render the row at all (capability + platform gating). */
  supported: boolean;
  /** Current on/off state of the faster unlock. */
  enabled: boolean;
  /** A toggle is in flight (the OS/browser prompt is up). */
  busy: boolean;
  /** Last failure message, or null. */
  error: string | null;
  iconName: IconName;
  title: string;
  detail: string;
  /** Flip the lock on/off. Owns its own busy/error handling — fire and forget. */
  toggle: (on: boolean) => void;
}

/**
 * Web: enroll a passkey (Touch ID / Face ID / Windows Hello) as a faster unlock than the
 * PIN. Hidden in the desktop (Electron) build by product choice; otherwise shown when a
 * platform authenticator is available OR a passkey is already enrolled (so a passkey from
 * a non-platform authenticator can still be toggled off).
 */
export function useAppLock(): AppLockControl {
  const { passkeyAvailable, passkeyEnrolled, enablePasskey, disablePasskey } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    (on: boolean) => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          if (on) await enablePasskey();
          else await disablePasskey();
        } catch (e) {
          setError(String((e as Error)?.message ?? e));
        } finally {
          setBusy(false);
        }
      })();
    },
    [enablePasskey, disablePasskey],
  );

  return {
    supported: (passkeyAvailable || passkeyEnrolled) && !isDesktop(),
    enabled: passkeyEnrolled,
    busy,
    error,
    iconName: 'key',
    title: 'Unlock with passkey',
    detail: 'Use Touch ID, Face ID or Windows Hello instead of typing your PIN.',
    toggle,
  };
}
