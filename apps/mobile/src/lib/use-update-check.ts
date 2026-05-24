import { useState } from 'react';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { desktopVersion } from './desktop';
import { useAppUpdate } from './use-app-update';
import { useDesktopUpdate } from './use-desktop-update';

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'downloaded' | 'unavailable' | 'error';

/** The running app version: the Electron app version on desktop (which can differ
 *  from the bundled web version), else the `app.json` version on native and web. */
export function appVersion(): string {
  return desktopVersion() ?? Constants.expoConfig?.version ?? '—';
}

interface UpdateCheck {
  /** The running app version, for display. */
  version: string;
  /** Result of the last check (or `idle` before one runs). */
  status: UpdateStatus;
  /** A check is in flight. */
  checking: boolean;
  /** An update is already downloaded and waiting (the global banner is showing).
   *  True too when expo-updates staged one passively before any manual check. */
  pending: boolean;
  /** Run a manual update check; a found update is downloaded so the banner shows. */
  check: () => Promise<void>;
}

/**
 * Manual "check for updates" for the settings screen. Wraps expo-updates'
 * check + fetch: a downloaded update flips `isUpdatePending`, which surfaces the
 * global DesktopUpdateBanner (with its Restart action) at the top of the app —
 * so this hook reports the check *result* and never applies the update itself.
 *
 * expo-updates is disabled on web, in the Electron renderer and in dev clients
 * (`Updates.isEnabled` is false), where `checkForUpdateAsync` throws
 * ERR_UPDATES_DISABLED. Desktop runs its own auto-updater, so on those platforms
 * we report the benign `unavailable` state rather than an error.
 */
export function useUpdateCheck(): UpdateCheck {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  // An update can be staged passively (downloaded at startup) before any manual
  // check, so the global banner may already be up. Surface that here too, else a
  // manual check returns "no update" (the bundle already matches) and the card
  // would read "latest version" while the banner says "Update ready".
  const { updateReady } = useAppUpdate();
  const desktopStaged = useDesktopUpdate();
  const pending = updateReady || !!desktopStaged;

  const check = async () => {
    if (!Updates.isEnabled) {
      setStatus('unavailable');
      return;
    }
    setStatus('checking');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        // Download it: this flips isUpdatePending, so the global update banner
        // surfaces with its Restart action.
        await Updates.fetchUpdateAsync();
        setStatus('downloaded');
      } else {
        setStatus('current');
      }
    } catch {
      setStatus('error');
    }
  };

  return { version: appVersion(), status, checking: status === 'checking', pending, check };
}
