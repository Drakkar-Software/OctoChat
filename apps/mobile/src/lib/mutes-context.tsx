/**
 * Reactive view over the per-identity mute prefs (`mutes.ts`), mounted once near the
 * root (below the session, above `UnreadProvider` which reads the muted-space set to
 * filter FCM topic subscriptions). The underlying snapshot lives in `mutes.ts` so the
 * notification code paths read it synchronously without React; this provider exposes a
 * subscribed view + the toggle actions for the settings UI.
 *
 * Hydration is driven by `session-context.hydrateCapsFor` (the single `_spaces` read
 * at startup), so this provider only mirrors the snapshot and resets it on sign-out.
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import {
  getMutePrefs,
  isMuteActive,
  resetMutes,
  setRoomMute,
  setSpaceMute,
  subscribeMutes,
} from './mutes';
import { useSession } from './session-context';

interface MutesValue {
  isRoomMuted: (roomId: string) => boolean;
  isSpaceMuted: (spaceId: string) => boolean;
  setRoomMuted: (roomId: string, muted: boolean) => void;
  setSpaceMuted: (spaceId: string, muted: boolean) => void;
}

const Ctx = createContext<MutesValue | null>(null);

export function MutesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const prefs = useSyncExternalStore(subscribeMutes, getMutePrefs, getMutePrefs);

  // Clear the snapshot on sign-out so a stale mute set never leaks past the session
  // (account switch / add already reset via session-context.resetAccountScopedState).
  useEffect(() => {
    if (!userId) resetMutes();
  }, [userId]);

  const value = useMemo<MutesValue>(
    () => ({
      isRoomMuted: (roomId) => isMuteActive(prefs.rooms[roomId]),
      isSpaceMuted: (spaceId) => isMuteActive(prefs.spaces[spaceId]),
      setRoomMuted: (roomId, muted) => {
        if (session) void setRoomMute(session, roomId, muted);
      },
      setSpaceMuted: (spaceId, muted) => {
        if (session) void setSpaceMute(session, spaceId, muted);
      },
    }),
    [prefs, session],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMutes(): MutesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMutes must be used within MutesProvider');
  return v;
}
