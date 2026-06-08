import { relaunchDesktop } from './desktop';
import { useAppUpdate } from './use-app-update';
import { useDesktopUpdate } from './use-desktop-update';

/**
 * Unifies the two OTA update sources behind one banner API:
 *
 * - **Desktop (Electron):** the custom web-bundle OTA (`useDesktopUpdate`).
 * - **Mobile (iOS / Android):** an expo-updates bundle (`useAppUpdate`).
 *
 * `pending` is true when either source has staged an update ready to apply;
 * `restart` applies whichever one fired. Consumed by {@link DesktopUpdateBanner}
 * and by `AppFrame`: on native the banner sits at the top of the app and clears
 * the notch, so while it's visible AppFrame zeroes the top safe-area inset for the
 * screens below (otherwise the native nav header / SafeAreaViews reserve the notch
 * a second time, leaving an empty band under the banner).
 */
export function useUpdateState(): { pending: boolean; restart: () => void } {
  const desktopVersion = useDesktopUpdate();
  const { updateReady, applyUpdate } = useAppUpdate();
  const pending = !!desktopVersion || updateReady;
  const restart = desktopVersion ? () => relaunchDesktop() : () => void applyUpdate();
  return { pending, restart };
}
