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
  getAiSettings,
  loadAiSettings,
  resetAiSettings,
  saveAiSettings,
  setAiSettings,
  subscribeAiSettings,
  type AiSettings,
} from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';

interface AiSettingsValue {
  settings: AiSettings;
  update: (patch: Partial<AiSettings>) => void;
}

const Ctx = createContext<AiSettingsValue | null>(null);

export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const settings = useSyncExternalStore(subscribeAiSettings, getAiSettings, getAiSettings);

  useEffect(() => {
    if (!userId) {
      resetAiSettings();
      return;
    }
    let active = true;
    void loadAiSettings(userId).then((next) => {
      if (active) setAiSettings(next);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = useCallback(
    (patch: Partial<AiSettings>) => {
      if (!userId) return;
      void saveAiSettings(userId, patch);
    },
    [userId],
  );

  const value = useMemo<AiSettingsValue>(() => ({ settings, update }), [settings, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAiSettings(): AiSettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAiSettings must be used within AiSettingsProvider');
  return v;
}
