/**
 * Shared quick-reaction palette, mounted once near the root (below the session,
 * above the message UI that consumes it). Loads the signed-in identity's palette
 * from kv on session change and exposes a reactive view + an `update` action. The
 * underlying snapshot lives in `quick-reactions-settings.ts` so the pattern mirrors
 * `notification-settings`.
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
  getQuickReactions,
  loadQuickReactions,
  resetQuickReactions,
  saveQuickReactions,
  setQuickReactions,
  subscribeQuickReactions,
} from './quick-reactions-settings';
import { useSession } from './session-context';

interface QuickReactionsValue {
  /** The six emojis, in palette order. */
  emojis: string[];
  /** Replace the whole palette (the card edits a working copy then commits it). */
  update: (emojis: string[]) => void;
}

const Ctx = createContext<QuickReactionsValue | null>(null);

export function QuickReactionsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const emojis = useSyncExternalStore(subscribeQuickReactions, getQuickReactions, getQuickReactions);

  // Load the identity's persisted palette; reset to defaults when signed out.
  useEffect(() => {
    if (!userId) {
      resetQuickReactions();
      return;
    }
    let active = true;
    void loadQuickReactions(userId).then((next) => {
      if (active) setQuickReactions(next);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = useCallback(
    (next: string[]) => {
      if (!userId) return;
      void saveQuickReactions(userId, next);
    },
    [userId],
  );

  const value = useMemo<QuickReactionsValue>(() => ({ emojis, update }), [emojis, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuickReactions(): QuickReactionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQuickReactions must be used within QuickReactionsProvider');
  return v;
}
