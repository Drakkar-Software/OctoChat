/**
 * Per-identity quick-reaction palette — the six emojis offered in the inline
 * message reaction picker ({@link MessageActions}). Synced server-side: the durable
 * source of truth is the user's own `_spaces` doc (a `quickReactions` key alongside
 * `mutes`/`reads`, see `registry.ts`), which a fresh device re-hydrates from its seed
 * so an edit on one device propagates cross-device. Held as a module-level snapshot —
 * like `mutes.ts` / `notification-settings.ts` — so a non-React caller can read it
 * synchronously; React consumers subscribe via {@link QuickReactionsProvider}.
 *
 * The snapshot seeds with the curated defaults so a picker opened before the session
 * hydrates still shows something sane; the synced palette overwrites it on load. There
 * is no local-kv cache (unlike `mutes`, which warms one for the headless push task) —
 * the palette has no background consumer, so an offline cold-start shows the defaults
 * until the next successful pull heals it.
 */
import type { Session } from './starfish/identity';
import { updateQuickReactionsDoc } from './starfish/registry';

/** How many emojis the quick-reaction palette holds — a fixed six slots. */
export const QUICK_REACTION_COUNT = 6;

/** The default palette, kept identical to the original hardcoded set. */
export const DEFAULT_QUICK_REACTIONS: string[] = ['👍', '😀', '😂', '❤️', '🎉', '🐙'];

let snapshot: string[] = DEFAULT_QUICK_REACTIONS;
const listeners = new Set<() => void>();
// Count of local palette writes whose server round-trip is still in flight. While > 0, a
// navigation/foreground re-hydrate (hydrateCapsFor) must NOT replace the snapshot: the
// server may not yet reflect the just-made optimistic edit, so a wholesale replace would
// visibly revert it. Twin of the `pending` guard in `mutes.ts`.
let pending = 0;

/** The live palette — synchronous read for any non-React caller. */
export function getQuickReactions(): string[] {
  return snapshot;
}

/** Subscribe to snapshot changes (drives `useSyncExternalStore`). */
export function subscribeQuickReactions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replace the live snapshot and notify React consumers. */
export function setQuickReactions(next: string[]): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Reset to defaults on sign-out so a fresh session never inherits the prior one's.
 *  Wired into `resetAccountScopedState` (the twin of `resetMutes`). */
export function resetQuickReactions(): void {
  setQuickReactions(DEFAULT_QUICK_REACTIONS);
}

/** Tolerant parse: coerce to exactly six slots, each a non-empty string, with any
 *  missing/garbage slot falling back to its position's default. */
function coerce(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_QUICK_REACTIONS;
  return DEFAULT_QUICK_REACTIONS.map((fallback, i) => {
    const v = raw[i];
    return typeof v === 'string' && v.length > 0 ? v : fallback;
  });
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Load the active account's palette into the snapshot. `serverPalette` comes from the
 * SAME `_spaces` read that hydrates caps/mutes (session-context), so the doc isn't
 * pulled twice. SERVER-AUTHORITATIVE wholesale replace — that is what lets an edit on
 * another device propagate here. A `pending` local write is left untouched (its own emit
 * already reflects the change). The strict {@link coerce} runs here so a doc that
 * predates the feature (reads back `[]`) hydrates to the defaults.
 */
export function hydrateQuickReactions(serverPalette: string[]): void {
  if (pending > 0) return;
  const next = coerce(serverPalette);
  if (arraysEqual(snapshot, next)) return; // unchanged — skip the re-render
  setQuickReactions(next);
}

/** Optimistically update the snapshot and sync the palette to the durable `_spaces`
 *  doc. `pending` brackets the round-trip so a navigation re-hydrate can't revert the
 *  optimistic emit before the server reflects it (twin of `setMute`). */
export async function saveQuickReactions(session: Session, emojis: string[]): Promise<void> {
  const next = coerce(emojis);
  setQuickReactions(next);
  pending++;
  try {
    await updateQuickReactionsDoc(session.accountClient, session.userId, () => next);
  } catch (err) {
    console.error('[OctoChat] quick reactions: failed to sync palette change', err);
  } finally {
    pending--;
  }
}
