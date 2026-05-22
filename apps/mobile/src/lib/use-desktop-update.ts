import { useEffect, useState } from 'react';
import { onDesktopUpdateReady } from './desktop';

/**
 * Returns the version string when an OTA bundle has been downloaded and is
 * ready to apply on the next relaunch. Null on all non-desktop platforms and
 * when no update is staged.
 */
export function useDesktopUpdate(): string | null {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  useEffect(() => {
    onDesktopUpdateReady(setUpdateVersion);
  }, []);
  return updateVersion;
}
