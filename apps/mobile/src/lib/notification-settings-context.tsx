/**
 * Shared notification preferences, mounted once near the root (below the session,
 * above the providers that consume them). Loads the signed-in identity's settings
 * from kv on session change and exposes a reactive view + an `update` action. The
 * underlying snapshot lives in `notification-settings.ts` so the notification code
 * paths can read it synchronously without React.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  getNotificationSettings,
  loadNotificationSettings,
  resetNotificationSettings,
  saveNotificationSettings,
  setNotificationSettings,
  subscribeNotificationSettings,
  type NotificationSettings,
} from './notification-settings';
import { useSession } from './session-context';

interface NotificationSettingsValue {
  settings: NotificationSettings;
  update: (patch: Partial<NotificationSettings>) => void;
}

const Ctx = createContext<NotificationSettingsValue | null>(null);

export function NotificationSettingsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const settings = useSyncExternalStore(
    subscribeNotificationSettings,
    getNotificationSettings,
    getNotificationSettings,
  );

  // Load the identity's persisted settings; reset to defaults when signed out.
  useEffect(() => {
    if (!userId) {
      resetNotificationSettings();
      return;
    }
    let active = true;
    void loadNotificationSettings(userId).then((next) => {
      if (active) setNotificationSettings(next);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = useCallback(
    (patch: Partial<NotificationSettings>) => {
      if (!userId) return;
      void saveNotificationSettings(userId, patch);
    },
    [userId],
  );

  const value = useMemo<NotificationSettingsValue>(() => ({ settings, update }), [settings, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotificationSettings(): NotificationSettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotificationSettings must be used within NotificationSettingsProvider');
  return v;
}
