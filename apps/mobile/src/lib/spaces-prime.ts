/**
 * One-shot handoff of the `_spaces` doc from session setup to {@link SpacesProvider}.
 *
 * Session establishment already reads the user's `_spaces` doc once (it carries the
 * durable member caps — see session-context `hydrateCapsFor`). That doc ALSO holds
 * the space list, so we stash it here for SpacesProvider to adopt instead of pulling
 * the very same doc again on first paint. Lives in its own tiny module so neither
 * `session-context` nor `spaces-context` has to import the other (they already form
 * a one-way edge via `useSession`).
 */
import type { Space } from '@/lib/types';

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
