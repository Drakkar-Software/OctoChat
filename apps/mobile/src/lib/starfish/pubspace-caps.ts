/**
 * Invitation caps for PUBLIC spaces this identity has JOINED via a link (vs. owns).
 * Maps spaceId → the link's credential so `use-room`/`use-rooms` can read/write the
 * plaintext `pubspaces/{ownerId}/{spaceId}/…` subtree as the link's ephemeral subject.
 *
 * Mirrors `member-caps.ts`: persisted via the platform kv and hydrated into an
 * in-memory cache once at startup so reads stay synchronous during render. The owner
 * of a public space needs NO entry here — they use their own account cap.
 */
import { kvGet, kvSet } from './kv';

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

const KEY = 'octochat.pubspacecaps.v1';

let cache: AccessMap = {};
let hydrated = false;

/** Load persisted public-space access into memory. Await once before opening rooms. */
export async function hydratePubspaceCaps(): Promise<void> {
  if (hydrated) return;
  const raw = await kvGet(KEY);
  if (raw) {
    try {
      cache = JSON.parse(raw) as AccessMap;
    } catch {
      cache = {};
    }
  }
  hydrated = true;
}

export function getPubspaceAccess(spaceId: string): PubspaceAccess | null {
  return cache[spaceId] ?? null;
}

export function savePubspaceAccess(spaceId: string, access: PubspaceAccess): void {
  cache = { ...cache, [spaceId]: access };
  void kvSet(KEY, JSON.stringify(cache));
}

/** Forget one joined public space's access (on leaving it). */
export function removePubspaceAccess(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  void kvSet(KEY, JSON.stringify(cache));
}

/** Forget all joined public-space access (on lock / identity switch). */
export function clearPubspaceCaps(): void {
  cache = {};
  void kvSet(KEY, JSON.stringify(cache));
}
