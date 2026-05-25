import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { clearAttachmentCache } from './starfish/attachments';
import {
  buildSession,
  deriveSession,
  fingerprintFromUserId,
  rootIdentityOf,
  type Session,
} from './starfish/identity';
import { clearMemberCaps, hydrateMemberCaps } from './starfish/member-caps';
import { clearPubspaceCaps, hydratePubspaceCaps } from './starfish/pubspace-caps';
import { readSpaces } from './starfish/registry';
import { clearSpaceEncryptors } from './starfish/space-encryptor';
import { passkeyEnrollable } from './starfish/passkey';
import {
  clearVault,
  loadVault,
  saveVault,
  unlockVault,
  vaultMethods,
} from './starfish/storage';
import type { PersistedSession, SeedLock, UnlockMethod, Vault } from './starfish/storage-types';
import { clearRoomEventsBus } from './room-events-bus';
import { clearPrimedSpaces, primeSpaces } from './spaces-prime';
import { clearPseudoCache, primeProfile } from './use-pseudos';

/** One row in the account switcher — enough to render and target a switch/logout. */
export interface AccountSummary {
  userId: string;
  name: string;
  fingerprint: string;
}

interface SessionContextValue {
  session: Session | null;
  /**
   * "loading" while restoring on launch; "locked" when a sealed vault exists and
   * needs a PIN/passkey to unlock (web); "switching" during an account swap/add;
   * "ready" once resolved either way.
   */
  status: 'loading' | 'locked' | 'switching' | 'ready';
  /** Unlock methods available for the locked persisted vault (web). */
  unlockMethods: UnlockMethod[];
  /** Whether to offer passkey enrollment: WebAuthn is usable AND a platform
   *  (biometric) authenticator is present. False until the async probe resolves. */
  passkeyAvailable: boolean;
  /** Every account held on this device (for the switcher). */
  accounts: AccountSummary[];
  /** userId of the active account, or null when signed out. */
  activeUserId: string | null;
  /** Seed staged by an onboarding screen, consumed by the lock-setup screen (web). */
  pendingSeed: { words: string[]; name?: string } | null;
  /** Stage a seed for the lock-setup screen (web onboarding). */
  prepareSignIn: (seedWords: string[], name?: string) => void;
  /** Create the FIRST identity from a 12-word seed and persist it (web requires `lock`). */
  signIn: (seedWords: string[], name?: string, lock?: SeedLock) => Promise<void>;
  /** Add another identity to the already-unlocked vault and make it active (no lock prompt). */
  addAccount: (seedWords: string[], name?: string) => Promise<void>;
  /** Make a held account active, tearing down and rebuilding account-scoped state. */
  switchAccount: (userId: string) => Promise<void>;
  /** Remove one account from this device; falls to another, or to welcome if it was the last. */
  logoutAccount: (userId: string) => Promise<void>;
  /** Unlock a persisted (sealed) vault with a PIN or passkey (web). */
  unlock: (method: UnlockMethod, pin?: string) => Promise<void>;
  /** Sign out of every account and forget the local vault. */
  fullSignOut: () => Promise<void>;
  /** The active account's 12-word seed from the in-memory vault, or null. */
  getActiveSeed: () => string[] | null;
  /** Re-check the app-lock (web) without rebuilding the session; throws on a wrong PIN/passkey. */
  verifyLock: (method: UnlockMethod, pin?: string) => Promise<void>;
  /** Enrolled lock methods for the active (unlocked) vault — for a re-auth prompt (web). */
  lockMethods: () => UnlockMethod[];
}

const Ctx = createContext<SessionContextValue | null>(null);

// Yield one macrotask so React commits the caller's `busy`/`switching` state and the
// browser paints the spinner BEFORE the synchronous, memory-hard Argon2id derivation
// locks the main thread. Without this the derivation starts in the same tick and the
// UI freezes with no feedback (the Argon2 impl only yields microtasks, which never
// trigger a repaint).
const yieldToPaint = () => new Promise((r) => setTimeout(r, 0));

// Wipe every module-level cache tied to the current identity. Called before swapping
// the active session so no data bleeds across accounts. The per-user member/pubspace
// caps reload from disk on the next hydrate; SSE/push/unread/room stores key on the
// session userId and self-reset via their own effect cleanups.
function resetAccountScopedState(): void {
  clearMemberCaps();
  clearPubspaceCaps();
  clearAttachmentCache();
  clearPseudoCache();
  clearSpaceEncryptors();
  clearPrimedSpaces();
  clearRoomEventsBus();
}

async function hydrateCapsFor(session: Session): Promise<void> {
  // Single read of the user's own `_spaces` doc — session-context is the one place
  // that pulls it at startup. It carries BOTH the durable member caps (which gate
  // E2EE access) and the space list, so we feed the caps to the member-cap cache and
  // prime SpacesProvider with the list; neither then re-reads the identical doc. Pass
  // the seed-authenticated accountClient (readSpaces degrades to empty on failure,
  // which leaves the local cap cache intact).
  const { spaces, caps } = await readSpaces(session.accountClient, session.userId);
  await hydrateMemberCaps(session.userId, caps);
  await hydratePubspaceCaps(session.userId);
  primeSpaces(session.userId, spaces);
  // Seed the shared public-profile cache with our own pseudo so `use-pseudos`
  // (message authors, sidebar) never fires a separate fetch for self — the editable
  // copy is loaded once by ProfileProvider, which also primes the avatar.
  primeProfile(session.userId, { pseudo: session.name });
}

// Rebuild a live session from a persisted one. Prefer the cached root identity
// (skips the heavy bootstrap Argon2id); fall back to re-deriving from the seed if
// it's missing or unusable (older blob / corruption).
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

/** The active account in a vault: the one matching `activeId`, else the first. */
function activeAccountOf(v: Vault): PersistedSession | null {
  if (v.accounts.length === 0) return null;
  return v.accounts.find((a) => a.derived?.userId === v.activeId) ?? v.accounts[0];
}

function summarize(v: Vault | null): AccountSummary[] {
  if (!v) return [];
  return v.accounts.map((a) => {
    const userId = a.derived?.userId ?? '';
    return { userId, name: a.name, fingerprint: userId ? fingerprintFromUserId(userId) : '' };
  });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'loading' | 'locked' | 'switching' | 'ready'>('loading');
  const [unlockMethods, setUnlockMethods] = useState<UnlockMethod[]>([]);
  // In-memory only and deliberately so: holding the 12 words here (not in the URL or
  // sessionStorage) keeps them off disk. A reload mid-onboarding drops it and routes
  // back to welcome — an acceptable cost for not persisting the phrase.
  const [pendingSeed, setPendingSeed] = useState<{ words: string[]; name?: string } | null>(null);
  // The decrypted vault. Mirrored into a ref so the async ops always read the latest
  // value without relying on closure freshness across awaits.
  const [vault, setVaultState] = useState<Vault | null>(null);
  const vaultRef = useRef<Vault | null>(null);
  // Serializes the in-app vault mutations (add/switch/logout) so two overlapping
  // ops can't read a stale vault and clobber each other's accounts.
  const opRef = useRef(false);
  // Whether to OFFER passkey enrollment. Requires a platform authenticator (biometric)
  // to be present, probed async — so it starts false (the enrollment UI must not flash
  // in, then hide, before the probe resolves). Unlock of an already-enrolled passkey is
  // gated separately in storage.methodsFor() on WebAuthn support alone.
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void passkeyEnrollable().then((ok) => {
      if (!cancelled) setPasskeyAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commitVault = (v: Vault | null) => {
    vaultRef.current = v;
    setVaultState(v);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadVault();
      if (cancelled) return;
      if (res.kind === 'locked') {
        setUnlockMethods(res.methods);
        setStatus('locked');
        return;
      }
      if (res.kind === 'ready') {
        commitVault(res.vault);
        const acct = activeAccountOf(res.vault);
        if (acct) {
          try {
            const s = await sessionFromPersisted(acct);
            await hydrateCapsFor(s);
            if (!cancelled) setSession(s);
          } catch {
            /* corrupt/stale persisted identity — start signed-out */
          }
        }
      }
      if (!cancelled) setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accounts = useMemo(() => summarize(vault), [vault]);

  // Seed of the active account. Resolved via activeAccountOf — the SAME selector the
  // live session is built from — so the seed always matches the current session, even
  // when activeId has fallen back to the first account. Null only when the vault is empty.
  const getActiveSeed = useCallback((): string[] | null => {
    const v = vaultRef.current;
    return v ? activeAccountOf(v)?.seed ?? null : null;
  }, []);

  // Re-check the app-lock WITHOUT rebuilding the session (web). unlockVault re-derives
  // the same VMK and returns the vault with no disk write / no other state mutation; it
  // throws on a wrong PIN/passkey — exactly SeedUnlock's onUnlock contract. The returned
  // vault is intentionally ignored: this only verifies, it does not swap the session.
  const verifyLock = useCallback(async (method: UnlockMethod, pin?: string): Promise<void> => {
    await unlockVault(method, pin);
  }, []);

  const lockMethods = useCallback((): UnlockMethod[] => vaultMethods(), []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      unlockMethods,
      passkeyAvailable,
      accounts,
      activeUserId: session?.userId ?? null,
      pendingSeed,
      prepareSignIn: (seedWords, name) => setPendingSeed({ words: seedWords, name }),
      signIn: async (seedWords, name, lock) => {
        await yieldToPaint();
        const s = await deriveSession(seedWords, name);
        // Cache the derived root identity so unlock/cold-start/switch skip the
        // bootstrap Argon2id (the seed stays too, as recovery + fallback).
        const persisted: PersistedSession = { seed: seedWords, name: s.name, derived: rootIdentityOf(s) };
        const next: Vault = { accounts: [persisted], activeId: s.userId };
        await saveVault(next, lock);
        commitVault(next);
        setPendingSeed(null);
        await hydrateCapsFor(s);
        setSession(s);
        setStatus('ready');
      },
      addAccount: async (seedWords, name) => {
        if (opRef.current) return;
        opRef.current = true;
        setStatus('switching');
        try {
          await yieldToPaint();
          const s = await deriveSession(seedWords, name);
          const persisted: PersistedSession = { seed: seedWords, name: s.name, derived: rootIdentityOf(s) };
          const cur = vaultRef.current ?? { accounts: [], activeId: '' };
          // Re-adding an existing seed replaces its entry rather than duplicating it.
          const others = cur.accounts.filter((a) => a.derived?.userId !== s.userId);
          const next: Vault = { accounts: [...others, persisted], activeId: s.userId };
          await saveVault(next);
          commitVault(next);
          setPendingSeed(null);
          resetAccountScopedState();
          await hydrateCapsFor(s);
          setSession(s);
        } finally {
          // Always leave 'switching' (clears the overlay) — the old session stays
          // intact on failure since setSession only runs on success.
          opRef.current = false;
          setStatus('ready');
        }
      },
      switchAccount: async (userId) => {
        const cur = vaultRef.current;
        if (!cur || (session?.userId ?? null) === userId) return;
        const acct = cur.accounts.find((a) => a.derived?.userId === userId);
        if (!acct || opRef.current) return;
        opRef.current = true;
        setStatus('switching');
        try {
          await yieldToPaint();
          // Build the new session first; only mutate the vault + caches once it's
          // known good, so a failed build leaves the current account untouched.
          const s = await sessionFromPersisted(acct);
          const next: Vault = { accounts: cur.accounts, activeId: userId };
          await saveVault(next);
          commitVault(next);
          resetAccountScopedState();
          await hydrateCapsFor(s);
          setSession(s);
        } finally {
          opRef.current = false;
          setStatus('ready');
        }
      },
      logoutAccount: async (userId) => {
        const cur = vaultRef.current;
        if (!cur || opRef.current) return;
        opRef.current = true;
        try {
          const remaining = cur.accounts.filter((a) => a.derived?.userId !== userId);
          if (remaining.length === 0) {
            await clearVault();
            resetAccountScopedState();
            commitVault(null);
            setSession(null);
            setUnlockMethods([]);
            return;
          }
          const wasActive = (session?.userId ?? cur.activeId) === userId;
          const next: Vault = {
            accounts: remaining,
            activeId: wasActive ? remaining[0].derived?.userId ?? '' : cur.activeId,
          };
          if (wasActive) {
            setStatus('switching');
            await yieldToPaint();
            // Build the fallback session before discarding the current one.
            const s = await sessionFromPersisted(remaining[0]);
            await saveVault(next);
            commitVault(next);
            resetAccountScopedState();
            await hydrateCapsFor(s);
            setSession(s);
          } else {
            await saveVault(next);
            commitVault(next);
          }
        } finally {
          opRef.current = false;
          setStatus('ready');
        }
      },
      unlock: async (method, pin) => {
        await yieldToPaint();
        const v = await unlockVault(method, pin);
        commitVault(v);
        const acct = activeAccountOf(v);
        if (acct) {
          const s = await sessionFromPersisted(acct);
          await hydrateCapsFor(s);
          setSession(s);
        }
        setUnlockMethods([]);
        setStatus('ready');
      },
      fullSignOut: async () => {
        await clearVault();
        resetAccountScopedState();
        commitVault(null);
        setSession(null);
        setUnlockMethods([]);
        setStatus('ready');
      },
      getActiveSeed,
      verifyLock,
      lockMethods,
    }),
    [session, status, unlockMethods, passkeyAvailable, accounts, pendingSeed, getActiveSeed, verifyLock, lockMethods],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
