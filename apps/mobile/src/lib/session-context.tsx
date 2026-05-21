import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { deriveSession, type Session } from './starfish/identity';
import { clearMemberCaps, hydrateMemberCaps } from './starfish/member-caps';
import { clearStoredSession, loadSession, saveSession } from './starfish/storage';

interface SessionContextValue {
  session: Session | null;
  /** "loading" while restoring a persisted identity on launch. */
  status: 'loading' | 'ready';
  /** Create/recover an identity from a 12-word seed and persist it. */
  signIn: (seedWords: string[], name?: string) => Promise<void>;
  /** Forget the local identity ("Lock app"). */
  lock: () => Promise<void>;
}

const Ctx = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateMemberCaps();
      const persisted = await loadSession();
      if (persisted && !cancelled) {
        try {
          const s = await deriveSession(persisted.seed, persisted.name);
          if (!cancelled) setSession(s);
        } catch {
          /* corrupt/stale persisted identity — start signed-out */
        }
      }
      if (!cancelled) setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      signIn: async (seedWords, name) => {
        const s = await deriveSession(seedWords, name);
        await saveSession({ seed: seedWords, name: s.name });
        setSession(s);
      },
      lock: async () => {
        await clearStoredSession();
        clearMemberCaps();
        setSession(null);
      },
    }),
    [session, status],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
