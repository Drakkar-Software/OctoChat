import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { buildSession, deriveSession, rootIdentityOf, type Session } from './starfish/identity';
import { clearMemberCaps, hydrateMemberCaps } from './starfish/member-caps';
import { clearPubspaceCaps, hydratePubspaceCaps } from './starfish/pubspace-caps';
import {
  clearStoredSession,
  loadStoredSession,
  passkeySupported,
  saveSession,
  unlockSession,
} from './starfish/storage';
import type { PersistedSession, SeedLock, UnlockMethod } from './starfish/storage-types';

interface SessionContextValue {
  session: Session | null;
  /**
   * "loading" while restoring on launch; "locked" when a sealed seed exists and
   * needs a PIN/passkey to unlock (web); "ready" once resolved either way.
   */
  status: 'loading' | 'locked' | 'ready';
  /** Unlock methods available for the locked persisted session (web). */
  unlockMethods: UnlockMethod[];
  /** Whether this platform/browser can enroll a passkey. */
  passkeyAvailable: boolean;
  /** Seed staged by an onboarding screen, consumed by the lock-setup screen (web). */
  pendingSeed: { words: string[]; name?: string } | null;
  /** Stage a seed for the lock-setup screen (web onboarding). */
  prepareSignIn: (seedWords: string[], name?: string) => void;
  /** Create/recover an identity from a 12-word seed and persist it (web requires `lock`). */
  signIn: (seedWords: string[], name?: string, lock?: SeedLock) => Promise<void>;
  /** Unlock a persisted (sealed) identity with a PIN or passkey (web). */
  unlock: (method: UnlockMethod, pin?: string) => Promise<void>;
  /** Forget the local identity ("Lock app"). */
  lock: () => Promise<void>;
}

const Ctx = createContext<SessionContextValue | null>(null);

// Yield one macrotask so React commits the caller's `busy` state and the browser
// paints the spinner BEFORE the synchronous, memory-hard Argon2id derivation
// locks the main thread. Without this the derivation starts in the same tick and
// the UI freezes with no feedback (the Argon2 impl only yields microtasks, which
// never trigger a repaint).
const yieldToPaint = () => new Promise((r) => setTimeout(r, 0));

// Rebuild a live session from a persisted one. Prefer the cached root identity
// (skips the heavy bootstrap Argon2id); fall back to re-deriving from the seed
// if it's missing or unusable (older blob / corruption).
async function sessionFromPersisted(p: PersistedSession): Promise<Session> {
  if (p.derived) {
    try {
      return await buildSession(p.derived, p.name);
    } catch {
      /* cached keys unusable — fall through to a full re-derive from the seed */
    }
  }
  return deriveSession(p.seed, p.name);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'loading' | 'locked' | 'ready'>('loading');
  const [unlockMethods, setUnlockMethods] = useState<UnlockMethod[]>([]);
  // In-memory only and deliberately so: holding the 12 words here (not in the URL
  // or sessionStorage) keeps them off disk. A reload mid-onboarding drops it and
  // routes back to welcome — an acceptable cost for not persisting the phrase.
  const [pendingSeed, setPendingSeed] = useState<{ words: string[]; name?: string } | null>(null);
  const passkeyAvailable = useMemo(() => passkeySupported(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateMemberCaps();
      await hydratePubspaceCaps();
      const res = await loadStoredSession();
      if (cancelled) return;
      if (res.kind === 'locked') {
        setUnlockMethods(res.methods);
        setStatus('locked');
        return;
      }
      if (res.kind === 'ready') {
        try {
          const s = await sessionFromPersisted(res.session);
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
      unlockMethods,
      passkeyAvailable,
      pendingSeed,
      prepareSignIn: (seedWords, name) => setPendingSeed({ words: seedWords, name }),
      signIn: async (seedWords, name, lock) => {
        await yieldToPaint();
        const s = await deriveSession(seedWords, name);
        // Cache the derived root identity so unlock/cold-start skips the bootstrap
        // Argon2id (the seed stays too, as recovery + fallback).
        await saveSession({ seed: seedWords, name: s.name, derived: rootIdentityOf(s) }, lock);
        setPendingSeed(null);
        setSession(s);
        setStatus('ready');
      },
      unlock: async (method, pin) => {
        await yieldToPaint();
        const persisted = await unlockSession(method, pin);
        const s = await sessionFromPersisted(persisted);
        setSession(s);
        setUnlockMethods([]);
        setStatus('ready');
      },
      lock: async () => {
        await clearStoredSession();
        clearMemberCaps();
        clearPubspaceCaps();
        setSession(null);
        setUnlockMethods([]);
        setStatus('ready');
      },
    }),
    [session, status, unlockMethods, passkeyAvailable, pendingSeed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
