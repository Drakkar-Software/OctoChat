import { useState } from 'react';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { checkDesktopUpdate, desktopVersion, isDesktop } from './desktop';
import { useAppUpdate } from './use-app-update';
import { useDesktopUpdate } from './use-desktop-update';

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'downloaded' | 'unavailable' | 'error';

/** The running app version: the Electron app version on desktop (which can differ
 *  from the bundled web version), else the `app.json` version on native and web. */
export function appVersion(): string {
  return desktopVersion() ?? Constants.expoConfig?.version ?? '—';
}

/** When the currently-running OTA bundle was published, formatted for display.
 *  Null in dev, on web, and on desktop where expo-updates is a no-op (so we
 *  never show a bogus date); a real EAS build reports `Updates.createdAt`. */
function lastUpdateDate(): string | null {
  if (isDesktop() || !Updates.isEnabled) return null;
  return Updates.createdAt
    ? Updates.createdAt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;
}

interface UpdateCheck {
  /** The running app version, for display. */
  version: string;
  /** When the running OTA bundle was published, formatted; null where
   *  expo-updates is a no-op (dev, web, desktop). */
  updatedAt: string | null;
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
 * Manual "check for updates" for the settings screen.
 *
 * - Desktop (Electron): expo-updates is disabled in the renderer, so the check
 *   is routed through the `window.octochat` bridge to the main-process OTA
 *   updater. A staged bundle surfaces the global DesktopUpdateBanner (with its
 *   Restart) via the separate `update-ready` push.
 * - Native (real EAS build): wraps expo-updates' check + fetch; a downloaded
 *   update flips `isUpdatePending`, surfacing the same banner.
 * - Web and dev clients: expo-updates is disabled (`Updates.isEnabled` false, so
 *   `checkForUpdateAsync` throws ERR_UPDATES_DISABLED), so we report the benign
 *   `unavailable` state rather than an error.
 *
 * Either way this hook reports the check *result* and never applies the update.
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
    // Desktop runs its own OTA updater in the Electron main process; expo-updates
    // is disabled in the renderer (Updates.isEnabled === false), so route the
    // button through the bridge instead of reporting "unavailable". The await
    // covers the download, so the button stays in its loading state until the
    // bundle is staged; a found update also flips `pending` via the push.
    if (isDesktop()) {
      setStatus('checking');
      const result = await checkDesktopUpdate();
      setStatus(
        result === 'updated'
          ? 'downloaded'
          : result === 'current'
            ? 'current'
            : result === 'error'
              ? 'error'
              : 'unavailable',
      );
      return;
    }
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

  return {
    version: appVersion(),
    updatedAt: lastUpdateDate(),
    status,
    checking: status === 'checking',
    pending,
    check,
  };
}
