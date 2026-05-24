import { useEffect, useState } from 'react';
import { getDesktopPendingUpdate, onDesktopUpdateReady } from './desktop';

/**
 * Returns the version string when an OTA bundle has been downloaded and is
 * ready to apply on the next relaunch. Null on all non-desktop platforms and
 * when no update is staged.
 *
 * Listens for the live `update-ready` push *and* pulls any update already staged
 * before mount — the push isn't buffered, so a check that finished during load
 * (common: it kicks off right after the window opens) would otherwise be missed.
 */
export function useDesktopUpdate(): string | null {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const apply = (v: string | null) => {
      if (active && v) setUpdateVersion(v);
    };
    onDesktopUpdateReady(apply);
    void getDesktopPendingUpdate().then(apply);
    return () => {
      active = false;
    };
  }, []);
  return updateVersion;
}
