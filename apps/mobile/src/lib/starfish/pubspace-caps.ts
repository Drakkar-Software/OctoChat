/**
 * Invitation caps for PUBLIC spaces this identity has JOINED via a link (vs. owns).
 * Maps spaceId → the link's credential so `use-room`/`use-rooms` can read/write the
 * plaintext `pubspaces/{ownerId}/{spaceId}/…` subtree as the link's ephemeral subject.
 *
 * Mirrors `member-caps.ts`: persisted via the platform kv, keyed PER-USER, and
 * hydrated into an in-memory cache on sign-in / account switch so reads stay
 * synchronous during render. The owner of a public space needs NO entry here — they
 * use their own account cap.
 */
import { kvGet, kvRemove, kvSet } from './kv';

/** Everything from an invitation link needed to authorize requests as its bearer. */
export interface PubspaceAccess {
  /** The space owner's userId — the `{ownerId}` storage-path segment + cap issuer. */
  ownerId: string;
  /** The owner-signed member cap-cert (CapCert), as parsed JSON. */
  cap: unknown;
  /** The throwaway ephemeral subject's Ed25519 private key (hex) — signs requests. */
  key: string;
  /** Whether this link grants write (read/write link) or read-only. */
  write: boolean;
}

type AccessMap = Record<string, PubspaceAccess>;

/** Pre-multi-account global blob; adopted once by the first user that hydrates. */
const LEGACY_KEY = 'octochat.pubspacecaps.v1';
const keyFor = (userId: string) => `octochat.pubspacecaps.${userId}`;

let cache: AccessMap = {};
let activeKey: string | null = null;

/**
 * Load the active account's public-space access into memory. Await on sign-in and on
 * every account switch, before opening rooms. Re-hydrating for the same user is a
 * no-op. These are invitation-link credentials, not re-derivable, so they are kept
 * per-user on disk and survive switching away and back.
 */
export async function hydratePubspaceCaps(userId: string): Promise<void> {
  const key = keyFor(userId);
  if (activeKey === key) return;
  activeKey = key;
  cache = {};
  let raw = await kvGet(key);
  if (raw === null) {
    const legacy = await kvGet(LEGACY_KEY);
    if (legacy !== null) {
      raw = legacy;
      await kvSet(key, legacy);
      await kvRemove(LEGACY_KEY);
    }
  }
  if (raw) {
    try {
      cache = JSON.parse(raw) as AccessMap;
    } catch {
      cache = {};
    }
  }
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

export function getPubspaceAccess(spaceId: string): PubspaceAccess | null {
  return cache[spaceId] ?? null;
}

export function savePubspaceAccess(spaceId: string, access: PubspaceAccess): void {
  cache = { ...cache, [spaceId]: access };
  persist();
}

/** Forget one joined public space's access (on leaving it). */
export function removePubspaceAccess(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  persist();
}

/** Drop the in-memory access (on account switch / sign-out); leaves disk untouched so
 *  the next {@link hydratePubspaceCaps} reloads the new (or re-added) user's set. */
export function clearPubspaceCaps(): void {
  cache = {};
  activeKey = null;
}
