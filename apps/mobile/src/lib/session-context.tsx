import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { deriveSession, type Session } from './starfish/identity';
import { clearMemberCaps, hydrateMemberCaps } from './starfish/member-caps';
import { clearPubspaceCaps, hydratePubspaceCaps } from './starfish/pubspace-caps';
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
      await hydratePubspaceCaps();
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
        // Yield one macrotask so React commits the caller's `busy` state and the
        // browser paints the spinner BEFORE the synchronous, memory-hard Argon2id
        // derivation in `deriveSession` locks the main thread. Without this the
        // derivation starts in the same tick and the UI freezes with no feedback
        // (the Argon2 impl only yields microtasks, which never trigger a repaint).
        await new Promise((r) => setTimeout(r, 0));
        const s = await deriveSession(seedWords, name);
        await saveSession({ seed: seedWords, name: s.name });
        setSession(s);
      },
      lock: async () => {
        await clearStoredSession();
        clearMemberCaps();
        clearPubspaceCaps();
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
