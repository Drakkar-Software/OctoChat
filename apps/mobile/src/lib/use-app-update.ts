import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';

/**
 * Wraps expo-updates to expose a stable update-banner API.
 *
 * `updateReady` becomes true when expo-updates has downloaded a new bundle
 * during the current session (`isUpdatePending`). Calling `applyUpdate`
 * reloads the JS bundle immediately via `Updates.reloadAsync()`.
 *
 * On web (where expo-updates is a no-op) and in dev mode, `updateReady` is
 * always false and `applyUpdate` is a no-op.
 *
 * Note: in SDK 56 the `useUpdates()` hook returns state only; actions use
 * the static Updates API.
 */
export function useAppUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const { isUpdatePending } = useUpdates();
  return {
    updateReady: isUpdatePending,
    applyUpdate: () => void Updates.reloadAsync(),
  };
}
