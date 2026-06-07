/**
 * Rebuild a live {@link Session} from a persisted vault entry — WITHOUT React.
 *
 * Extracted from `session-context.tsx` so it can also run in a headless context
 * (the native FCM background-message handler, see `push/background-notify.native`),
 * which has no provider tree. The session-context provider re-imports both helpers,
 * so its restore/switch/unlock flows are unchanged.
 */
import {
  buildLinkedSession,
  buildSession,
  deriveSession,
  type Session,
} from './identity';
import type { PersistedSession, Vault } from './storage-types';

/**
 * Rebuild a live session from a persisted one. Prefer the cached root identity
 * (skips the heavy bootstrap Argon2id); fall back to re-deriving from the seed if
 * it's missing or unusable (older blob / corruption). Nostr-derived accounts have
 * no seed — they MUST have a usable `derived`, so a failure there is terminal.
 *
 * The cached-`derived` fast path (`buildSession`) is what makes this safe to call
 * from the background handler: it only mints caps, never runs Argon2id (which would
 * blow a headless task's time budget). A persisted account with neither usable
 * derived keys nor a seed throws.
 */
export async function sessionFromPersisted(p: PersistedSession): Promise<Session> {
  // Paired (linked) device: rebuild from the delegated cap-cert. Its keypair is not
  // the root, so it can't self-mint or re-derive — this branch has no fallback.
  if (p.capCert && p.derived) {
    return buildLinkedSession({ userId: p.derived.userId, keys: p.derived.keys, capCert: p.capCert }, p.name);
  }
  if (p.derived) {
    try {
      return await buildSession(p.derived, p.name);
    } catch {
      /* cached keys unusable — fall through to a full re-derive from the seed */
    }
  }
  if (p.seed) return deriveSession(p.seed, p.name);
  throw new Error('Persisted account has neither usable derived keys nor a recovery seed.');
}

/** The active account in a vault: the one matching `activeId`, else the first. */
export function activeAccountOf(v: Vault): PersistedSession | null {
  if (v.accounts.length === 0) return null;
  return v.accounts.find((a) => a.derived?.userId === v.activeId) ?? v.accounts[0];
}
