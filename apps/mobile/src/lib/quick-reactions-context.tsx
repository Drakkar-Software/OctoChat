/**
 * Shared quick-reaction palette, mounted once near the root (below the session,
 * above the message UI that consumes it). Exposes a reactive view of the synced
 * palette + an `update` action that writes through to the server. The underlying
 * snapshot lives in `quick-reactions-settings.ts` (hydrated from the `_spaces` doc by
 * session-context, like `mutes`); this provider only reads it and wires `update`.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { getQuickReactions, saveQuickReactions, subscribeQuickReactions } from '@drakkar.software/octochat-sdk';
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
  const emojis = useSyncExternalStore(subscribeQuickReactions, getQuickReactions, getQuickReactions);

  const update = useCallback(
    (next: string[]) => {
      if (!session) return;
      void saveQuickReactions(session, next);
    },
    [session],
  );

  const value = useMemo<QuickReactionsValue>(() => ({ emojis, update }), [emojis, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuickReactions(): QuickReactionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQuickReactions must be used within QuickReactionsProvider');
  return v;
}
