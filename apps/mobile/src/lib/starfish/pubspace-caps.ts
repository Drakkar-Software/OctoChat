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

export type AccessMap = Record<string, PubspaceAccess>;

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
    } catch (e) {
      // Surface, don't swallow: pubspace access has NO durable server copy, so a
      // corrupt blob is unrecoverable without the original invite link. Only the
      // in-memory cache is reset here (persist() runs on next save), so the raw blob
      // stays on disk for diagnosis until then.
      console.error('[OctoChat] pubspace-caps: corrupt cache blob, resetting in-memory:', e);
      cache = {};
    }
  }
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

/**
 * Merge access entries recovered from the synced `_spaces` doc OVER the in-memory
 * cache (server wins) and warm the local kv — the public twin of `member-caps.ts`
 * step 2. This is what lets a device that never opened the invite link recover
 * read/write access to a public space it sees in its list. Call AFTER
 * {@link hydratePubspaceCaps} has set the active user (so `persist()` targets the
 * right key). Empty `entries` is a no-op (leaves the local-only cache intact).
 */
export function mergePubspaceAccess(entries: AccessMap): void {
  if (Object.keys(entries).length === 0) return;
  cache = { ...cache, ...entries };
  persist();
}

/** A snapshot of the in-memory access cache — used to compute which device-local
 *  entries are missing from the synced doc and need a one-time backfill. */
export function localPubspaceEntries(): AccessMap {
  return cache;
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
