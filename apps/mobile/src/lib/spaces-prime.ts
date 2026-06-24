/**
 * One-shot handoff of the `_spaces` doc from session setup to {@link SpacesProvider}.
 *
 * Session establishment already reads the user's `_spaces` doc once (it carries the
 * durable member caps — see session-context `hydrateCapsFor`). That doc ALSO holds
 * the space list, so we stash it here for SpacesProvider to adopt instead of pulling
 * the very same doc again on first paint. Lives in its own tiny module so neither
 * `session-context` nor `spaces-context` has to import the other (they already form
 * a one-way edge via `useSession`).
 *
 * The in-memory stash covers the common case (session setup → SpacesProvider mount
 * within the same JS tick). A kv-backed snapshot covers the cold-start case: the
 * snapshot is persisted at the end of every successful hydrateCapsFor and loaded
 * before setStatus('ready'), so SpacesProvider always paints from cache instantly
 * without waiting for a network round-trip.
 */
import type { Space } from '@drakkar.software/octochat-sdk';
import { kvGet, kvSet } from './app-kv';

const snapshotKey = (userId: string) => `octochat.spaces-snapshot.${userId}`;

interface PrimedSpaces {
  userId: string;
  spaces: Space[];
  at: number;
}

let primed: PrimedSpaces | null = null;

/** Stash the space list read during session setup, keyed by identity. */
export function primeSpaces(userId: string, spaces: Space[]): void {
  primed = { userId, spaces, at: Date.now() };
}

/**
 * Adopt the primed spaces for `userId`, if a fresh stash exists (set in the last few
 * seconds, for this identity). Returns null — so the caller reads the doc itself —
 * when absent, stale, or for a different account. Consuming clears the stash.
 */
export function consumePrimedSpaces(userId: string): Space[] | null {
  if (!primed || primed.userId !== userId || Date.now() - primed.at > 10_000) return null;
  const { spaces } = primed;
  primed = null;
  return spaces;
}

/** Drop any stash (account switch / sign-out). */
export function clearPrimedSpaces(): void {
  primed = null;
}

/**
 * Persist the spaces list to kv so the next cold start can prime instantly
 * without a network round-trip. Called by hydrateCapsFor after a successful
 * network read so the snapshot reflects the latest server state.
 */
export function persistSpacesSnapshot(userId: string, spaces: Space[]): void {
  void kvSet(snapshotKey(userId), JSON.stringify(spaces)).catch(() => {});
}

/**
 * Load the persisted spaces snapshot for `userId`. Returns null on cache miss,
 * parse error, or an empty snapshot (so callers fall through to a network read).
 */
export async function loadSpacesSnapshot(userId: string): Promise<Space[] | null> {
  try {
    const raw = await kvGet(snapshotKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Space[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
