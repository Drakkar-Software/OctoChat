/**
 * One-shot handoff of the `_spaces` doc from session setup to {@link SpacesProvider}.
 *
 * Session establishment already reads the user's `_spaces` doc once (it carries the
 * durable member caps — see session-context `hydrateCapsFor`). That doc ALSO holds
 * the space list and the `dms` peer-index, so we stash both here for SpacesProvider
 * to adopt instead of pulling the very same doc again on first paint. Lives in its
 * own tiny module so neither `session-context` nor `spaces-context` has to import
 * the other (they already form a one-way edge via `useSession`).
 *
 * The in-memory stash covers the common case (session setup → SpacesProvider mount
 * within the same JS tick). A kv-backed snapshot covers the cold-start case: the
 * snapshot is persisted at the end of every successful hydrateCapsFor and loaded
 * before setStatus('ready'), so SpacesProvider always paints from cache instantly
 * without waiting for a network round-trip.
 *
 * ## Snapshot schema versioning
 *
 * v1 (legacy): bare `Space[]` — written by older builds.
 * v2 (current): `{ v: 2, spaces: Space[], dms: DmMap }` — adds the peer→DM-space
 * map so the DM list paints from cache on cold start without waiting for refresh().
 *
 * `loadSpacesSnapshot` does a TOLERANT parse: a bare array is treated as v1 and
 * returned with `dms: {}`. The kv key is UNCHANGED so existing snapshots are not
 * thrown away on upgrade — a first launch after deploy reads the v1 snapshot and
 * hydrates the spaces immediately; the `dms` is empty until the first network read,
 * which is the same behaviour as before this change.
 */
import type { DmMap, Space } from '@drakkar.software/octochat-sdk';
import { kvGet, kvSet } from './app-kv';

const snapshotKey = (userId: string) => `octochat.spaces-snapshot.${userId}`;

interface PrimedSpaces {
  userId: string;
  spaces: Space[];
  dms: DmMap;
  at: number;
}

let primed: PrimedSpaces | null = null;

/** Stash the space list and DM map read during session setup, keyed by identity. */
export function primeSpaces(userId: string, spaces: Space[], dms: DmMap = {}): void {
  primed = { userId, spaces, dms, at: Date.now() };
}

/**
 * Adopt the primed spaces for `userId`, if a fresh stash exists (set in the last few
 * seconds, for this identity). Returns null — so the caller reads the doc itself —
 * when absent, stale, or for a different account. Consuming clears the stash.
 */
export function consumePrimedSpaces(userId: string): { spaces: Space[]; dms: DmMap } | null {
  if (!primed || primed.userId !== userId || Date.now() - primed.at > 10_000) return null;
  const { spaces, dms } = primed;
  primed = null;
  return { spaces, dms };
}

/** Drop any stash (account switch / sign-out). */
export function clearPrimedSpaces(): void {
  primed = null;
}

/**
 * Persist the spaces list and DM map to kv so the next cold start can prime
 * instantly without a network round-trip. Called by hydrateCapsFor after a
 * successful network read so the snapshot reflects the latest server state.
 * Written as a v2 versioned envelope.
 */
export function persistSpacesSnapshot(userId: string, spaces: Space[], dms: DmMap = {}): void {
  void kvSet(snapshotKey(userId), JSON.stringify({ v: 2, spaces, dms })).catch(() => {});
}

/**
 * Load the persisted spaces snapshot for `userId`. Returns null on cache miss,
 * parse error, or an empty snapshot (so callers fall through to a network read).
 *
 * Tolerant parse:
 *   - Bare `Space[]` (v1 from older builds) → `{ spaces, dms: {} }`
 *   - `{ v: 2, spaces, dms }` (v2) → `{ spaces, dms }`
 */
export async function loadSpacesSnapshot(userId: string): Promise<{ spaces: Space[]; dms: DmMap } | null> {
  try {
    const raw = await kvGet(snapshotKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    let spaces: Space[];
    let dms: DmMap;
    if (Array.isArray(parsed)) {
      // v1: bare Space[]
      spaces = parsed as Space[];
      dms = {};
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as { spaces?: unknown; dms?: unknown };
      spaces = Array.isArray(obj.spaces) ? (obj.spaces as Space[]) : [];
      dms = (obj.dms && typeof obj.dms === 'object' && !Array.isArray(obj.dms))
        ? (obj.dms as DmMap)
        : {};
    } else {
      return null;
    }
    return spaces.length > 0 ? { spaces, dms } : null;
  } catch {
    return null;
  }
}
