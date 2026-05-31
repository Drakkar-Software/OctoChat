/**
 * Per-identity quick-reaction palette — the six emojis offered in the inline
 * message reaction picker ({@link MessageActions}). Persisted to the platform KV
 * store (localStorage on web, AsyncStorage on native) and held as a module-level
 * snapshot so the pattern matches `notification-settings.ts`; React consumers
 * subscribe via {@link QuickReactionsProvider} (`useSyncExternalStore`).
 *
 * The snapshot seeds with the curated defaults so a picker opened before kv
 * hydrates still shows something sane; the per-identity values overwrite it on load.
 */
import { kvGet, kvSet } from './starfish/kv';

/** How many emojis the quick-reaction palette holds — a fixed six slots. */
export const QUICK_REACTION_COUNT = 6;

/** The default palette, kept identical to the original hardcoded set. */
export const DEFAULT_QUICK_REACTIONS: string[] = ['👍', '😀', '😂', '❤️', '🎉', '🐙'];

const settingsKey = (userId: string) => `octochat.quickReactions.${userId}`;

let snapshot: string[] = DEFAULT_QUICK_REACTIONS;
const listeners = new Set<() => void>();

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

/** Reset to defaults on sign-out so a fresh session never inherits the prior one's. */
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

/** Read this identity's persisted palette (does NOT mutate the snapshot — the
 *  provider sets it under a staleness guard). */
export async function loadQuickReactions(userId: string): Promise<string[]> {
  const raw = await kvGet(settingsKey(userId));
  if (!raw) return DEFAULT_QUICK_REACTIONS;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return DEFAULT_QUICK_REACTIONS;
  }
}

/** Persist the palette for the identity and update the live snapshot. */
export async function saveQuickReactions(userId: string, emojis: string[]): Promise<void> {
  const next = coerce(emojis);
  setQuickReactions(next);
  await kvSet(settingsKey(userId), JSON.stringify(next));
}
