import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { BootstrapOrigin, RootIdentity } from '@drakkar.software/starfish-identities';

import { clearAttachmentCache } from './starfish/attachments';
import {
  buildLinkedSession,
  buildSession,
  deriveSession,
  fingerprintFromUserId,
  rootIdentityOf,
  type LinkedIdentity,
  type Session,
} from './starfish/identity';
import { clearMemberCaps, hydrateMemberCaps } from './starfish/member-caps';
import { recoverPubspaceAccess } from './starfish/pubspace';
import { clearPubspaceCaps, hydratePubspaceCaps } from './starfish/pubspace-caps';
import { readSpaces } from './starfish/registry';
import { hydrateMutes, resetMutes } from './mutes';
import { hydrateQuickReactions, resetQuickReactions } from './quick-reactions-settings';
import { flushReadsNow, hydrateReads, resetReads } from './reads';
import { activeAccountOf, sessionFromPersisted } from './starfish/session-restore';
import { clearSpaceEncryptors } from './starfish/space-encryptor';
import { enrollPasskey, passkeyEnrollable } from './starfish/passkey';
import {
  addPasskeyToVault,
  clearVault,
  loadVault,
  removePasskeyFromVault,
  saveVault,
  unlockVault,
  vaultMethods,
} from './starfish/storage';
import { disableBiometricLock } from './app-lock';
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
  /** Nostr-derived root identity staged by the welcome screen, consumed by the
   *  lock-setup screen (web). Mirrors {@link pendingSeed} for the NIP-07 flow. */
  pendingNostrIdentity: { root: RootIdentity; name?: string } | null;
  /** Stage a seed for the lock-setup screen (web onboarding). */
  prepareSignIn: (seedWords: string[], name?: string) => void;
  /** Stage a Nostr-derived root identity for the lock-setup screen (web onboarding). */
  prepareNostrSignIn: (root: RootIdentity, name?: string) => void;
  /** Create the FIRST identity from a 12-word seed and persist it (web requires `lock`). */
  signIn: (seedWords: string[], name?: string, lock?: SeedLock) => Promise<void>;
  /** Create the FIRST identity from a Nostr-derived root identity and persist it (web requires `lock`). */
  signInWithRootIdentity: (root: RootIdentity, name?: string, lock?: SeedLock) => Promise<void>;
  /** Add another identity to the already-unlocked vault and make it active (no lock prompt). */
  addAccount: (seedWords: string[], name?: string) => Promise<void>;
  /** Add another Nostr-derived identity to the already-unlocked vault (no lock prompt). */
  addAccountWithRootIdentity: (root: RootIdentity, name?: string) => Promise<void>;
  /** Add a PAIRED (linked) device's identity to the vault and make it active.
   *  Persists the delegated cap-cert (no seed). A signed-out web device must pass
   *  `lock` to establish its app-lock (first seal); native and already-unlocked
   *  web ignore it. */
  addLinkedDevice: (linked: LinkedIdentity, name?: string, lock?: SeedLock) => Promise<void>;
  /** Make a held account active, tearing down and rebuilding account-scoped state. */
  switchAccount: (userId: string) => Promise<void>;
  /** Remove one account from this device; falls to another, or to welcome if it was the last. */
  logoutAccount: (userId: string) => Promise<void>;
  /** Unlock a persisted (sealed) vault with a PIN or passkey (web). */
  unlock: (method: UnlockMethod, pin?: string) => Promise<void>;
  /** Sign out of every account and forget the local vault. */
  fullSignOut: () => Promise<void>;
  /** The active account's 12-word seed from the in-memory vault, or null
   *  (no active account, or a non-seed origin like Nostr). */
  getActiveSeed: () => string[] | null;
  /** Bootstrap origin of the active account (e.g. Nostr secp256k1 root). Null
   *  when the account is plain seed-derived or there is no active account. */
  activeBootstrapOrigin: BootstrapOrigin | null;
  /** Re-check the app-lock (web) without rebuilding the session; throws on a wrong PIN/passkey. */
  verifyLock: (method: UnlockMethod, pin?: string) => Promise<void>;
  /** Enrolled lock methods for the active (unlocked) vault — for a re-auth prompt (web). */
  lockMethods: () => UnlockMethod[];
  /** Whether a passkey is currently enrolled as a vault unlock (web). Reactive so the
   *  security-card toggle reflects enroll/remove without a reload. */
  passkeyEnrolled: boolean;
  /** Enroll a WebAuthn passkey on the unlocked vault as a faster unlock than the PIN
   *  (web; runs the browser passkey prompt). Throws on cancel/failure. */
  enablePasskey: () => Promise<void>;
  /** Remove the enrolled passkey, leaving the PIN as the unlock (web). */
  disablePasskey: () => Promise<void>;
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
  // Flush any pending read marks before dropping them so a just-read room on the
  // outgoing account isn't lost; then clear the in-memory snapshot.
  void flushReadsNow();
  resetMutes();
  resetReads();
  resetQuickReactions();
}

async function hydrateCapsFor(session: Session): Promise<void> {
  // Single read of the user's own `_spaces` doc — session-context is the one place
  // that pulls it at startup. It carries BOTH the durable member caps (which gate
  // E2EE access) and the space list, so we feed the caps to the member-cap cache and
  // prime SpacesProvider with the list; neither then re-reads the identical doc. Pass
  // the seed-authenticated accountClient (readSpaces degrades to empty on failure,
  // which leaves the local cap cache intact).
  const { spaces, caps, mutes, reads, pubAccess, quickReactions } = await readSpaces(session.accountClient, session.userId);
  await hydrateMemberCaps(session.userId, caps);
  await hydratePubspaceCaps(session.userId);
  // Public-space credentials carry a bearer secret, so they ride the synced doc SEALED
  // to the account key. Recover them into the local cache (gives a device that never
  // opened the link access) and backfill any local-only ones up to the doc. Best-effort
  // and after hydratePubspaceCaps so the local cache + active user are set. See
  // `pubspace.ts` recoverPubspaceAccess.
  await recoverPubspaceAccess(session, pubAccess);
  // Mute prefs share the same `_spaces` doc, so the single read above already carries
  // them — feed them to the mute cache (server-authoritative; an unreachable read
  // degrades to empty upstream, which a later successful sync re-heals). No second pull.
  await hydrateMutes(session.userId, mutes);
  // Read marks share the same `_spaces` doc — feed them to the read cache (max-merged
  // with local so an offline read survives). No second pull. See `reads.ts`.
  await hydrateReads(session.userId, reads);
  // Quick-reaction palette shares the same `_spaces` doc — feed it to the palette
  // snapshot (server-authoritative; an offline read degrades to `[]` upstream, which
  // hydrates to the defaults and a later successful sync re-heals). No second pull.
  hydrateQuickReactions(quickReactions);
  primeSpaces(session.userId, spaces);
  // Seed the shared public-profile cache with our own pseudo so `use-pseudos`
  // (message authors, sidebar) never fires a separate fetch for self — the editable
  // copy is loaded once by ProfileProvider, which also primes the avatar.
  primeProfile(session.userId, { pseudo: session.name });
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
  // Same rationale for the Nostr-derived root identity: the device keys here are
  // private-key-equivalent (HKDF'd from the secp256k1 signature), so they stay in
  // memory until the lock-setup screen seals them under the PIN.
  const [pendingNostrIdentity, setPendingNostrIdentity] = useState<{ root: RootIdentity; name?: string } | null>(null);
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
  // Whether a passkey is enrolled on the persisted vault (web; always false on native,
  // where vaultMethods() is empty). Recomputed whenever the vault or lock state changes,
  // and set directly by enable/disable below — those mutate only the wraps, not the
  // in-memory Vault object, so the effect alone wouldn't observe them.
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);
  useEffect(() => {
    setPasskeyEnrolled(vaultMethods().includes('passkey'));
  }, [vault, status]);

  const commitVault = (v: Vault | null) => {
    vaultRef.current = v;
    setVaultState(v);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadVault();
      if (cancelled) return;
      if (res.kind === 'error') {
        // A storage read failed (e.g. transient Keychain miss on iOS cold start).
        // Stay in 'loading' so index.tsx renders null — welcome-on-storage-error
        // wipes the user's perceived account even though the vault is still on
        // disk. The next cold start usually succeeds; a follow-up could add retry.
        console.error('[session-context] loadVault failed', res.error);
        return;
      }
      if (res.kind === 'none') {
        // Genuine "no account" for a first-time user is the happy path → welcome.
        // But on iOS cold start a not-yet-ready Keychain can RESOLVE getItemAsync
        // with null (no throw), which lands here too. Log so the next cold-start
        // welcome incident is diagnosable: a user who already had an account
        // seeing this line means the storage read returned empty on a populated
        // Keychain — i.e. the same root cause as a thrown error.
        console.info('[session-context] storage reported no account → welcome');
      }
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
            // Set the session BEFORE caps hydrate so a caps hiccup can't sign the
            // user out — hydrateMemberCaps already loads the local kv first, so
            // the user has the offline cap set even if the server merge fails.
            if (!cancelled) setSession(s);
            await hydrateCapsFor(s).catch((err) => {
              console.error('[session-context] caps hydrate failed (session kept)', err);
            });
          } catch (err) {
            // Genuine corrupt/stale persisted identity OR sessionFromPersisted
            // throw. Log so the next cold-start welcome incident is diagnosable.
            console.error('[session-context] sessionFromPersisted failed', err);
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
  // when activeId has fallen back to the first account. Null when the vault is empty
  // OR when the active account has no seed (e.g. Nostr-derived).
  const getActiveSeed = useCallback((): string[] | null => {
    const v = vaultRef.current;
    return v ? activeAccountOf(v)?.seed ?? null : null;
  }, []);

  // The active account's bootstrap origin, recomputed when the vault changes so
  // the You-tab security card can switch between "Recovery seed" and "Linked to
  // Nostr" reactively. Re-read from vaultRef would not trigger a re-render.
  const activeBootstrapOrigin: BootstrapOrigin | null = useMemo(
    () => (vault ? activeAccountOf(vault)?.bootstrapOrigin ?? null : null),
    [vault],
  );

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
      pendingNostrIdentity,
      prepareSignIn: (seedWords, name) => setPendingSeed({ words: seedWords, name }),
      prepareNostrSignIn: (root, name) => setPendingNostrIdentity({ root, name }),
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
      signInWithRootIdentity: async (root, name, lock) => {
        await yieldToPaint();
        // No Argon2id here — the root identity is already derived from the
        // secp256k1 signature. buildSession only mints caps + ensures the pseudo.
        const s = await buildSession({ userId: root.userId, keys: root.keys }, name);
        // No seed: re-login uses the same Nostr extension. `derived` is required
        // for restore (sessionFromPersisted has no seed fallback for this branch).
        const persisted: PersistedSession = {
          name: s.name,
          derived: rootIdentityOf(s),
          bootstrapOrigin: root.bootstrapOrigin,
        };
        const next: Vault = { accounts: [persisted], activeId: s.userId };
        await saveVault(next, lock);
        commitVault(next);
        setPendingNostrIdentity(null);
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
      addAccountWithRootIdentity: async (root, name) => {
        if (opRef.current) return;
        opRef.current = true;
        setStatus('switching');
        try {
          await yieldToPaint();
          const s = await buildSession({ userId: root.userId, keys: root.keys }, name);
          const persisted: PersistedSession = {
            name: s.name,
            derived: rootIdentityOf(s),
            bootstrapOrigin: root.bootstrapOrigin,
          };
          const cur = vaultRef.current ?? { accounts: [], activeId: '' };
          // Re-adding the same Nostr root replaces its entry rather than duplicating it.
          const others = cur.accounts.filter((a) => a.derived?.userId !== s.userId);
          const next: Vault = { accounts: [...others, persisted], activeId: s.userId };
          await saveVault(next);
          commitVault(next);
          setPendingNostrIdentity(null);
          resetAccountScopedState();
          await hydrateCapsFor(s);
          setSession(s);
        } finally {
          opRef.current = false;
          setStatus('ready');
        }
      },
      addLinkedDevice: async (linked, name, lock) => {
        if (opRef.current) return;
        opRef.current = true;
        setStatus('switching');
        try {
          await yieldToPaint();
          // No Argon2id and no self-mint: buildLinkedSession drives both clients off
          // the root-signed cap-cert. Persist the device keypair + the cert (no seed).
          const s = await buildLinkedSession(linked, name);
          const persisted: PersistedSession = {
            name: s.name,
            derived: { userId: linked.userId, keys: linked.keys },
            capCert: linked.capCert,
          };
          const cur = vaultRef.current ?? { accounts: [], activeId: '' };
          // Re-pairing the same account replaces its entry rather than duplicating it.
          const others = cur.accounts.filter((a) => a.derived?.userId !== s.userId);
          const next: Vault = { accounts: [...others, persisted], activeId: s.userId };
          // `lock` seals a fresh vault on a signed-out web device (first app-lock);
          // omitted when adding to an already-unlocked vault or on native (Keychain).
          await saveVault(next, lock);
          commitVault(next);
          resetAccountScopedState();
          await hydrateCapsFor(s);
          setSession(s);
        } finally {
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
            // Last account gone → drop the native biometric lock flag too, so it can't
            // strand a future signed-out welcome screen behind a prompt (no-op on web).
            void disableBiometricLock();
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
        void disableBiometricLock();
        resetAccountScopedState();
        commitVault(null);
        setSession(null);
        setUnlockMethods([]);
        setStatus('ready');
      },
      getActiveSeed,
      activeBootstrapOrigin,
      verifyLock,
      lockMethods,
      passkeyEnrolled,
      enablePasskey: async () => {
        // Enroll on the live gesture, then wrap the unlocked VMK under its PRF secret.
        const passkey = await enrollPasskey('OctoChat');
        await addPasskeyToVault(passkey);
        setPasskeyEnrolled(true);
      },
      disablePasskey: async () => {
        await removePasskeyFromVault();
        setPasskeyEnrolled(false);
      },
    }),
    [
      session,
      status,
      unlockMethods,
      passkeyAvailable,
      accounts,
      pendingSeed,
      pendingNostrIdentity,
      getActiveSeed,
      activeBootstrapOrigin,
      verifyLock,
      lockMethods,
      passkeyEnrolled,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
