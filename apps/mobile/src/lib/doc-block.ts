/**
 * Doc block model + Markdown projection — pure (no React, no I/O), the twin of
 * {@link foldProject} in `project-board.ts`. Kept out of `use-doc.ts` so it imports
 * (and tests) without pulling the merge-doc / React Native machinery.
 */
import { splitMarkdownBlocks } from './markdown';
import type { ID } from './types';

/** A block of doc body content. Union-merged on `id` keyed by `updatedAt`, so two
 *  devices editing different blocks of the same doc both survive a merge. First-
 *  version docs store `md` blocks (raw Markdown in `text`); the legacy typed
 *  variants still render so any seeded content survives. */
export interface DocBlock {
  id: ID;
  type: 'md' | 'h2' | 'p' | 'quote' | 'bullets';
  text?: string;
  items?: string[];
  order: number;
  updatedAt: number;
}

/** Project a block to the Markdown source the renderer + editor both consume.
 *  Legacy typed blocks lift to equivalent Markdown so editing migrates them to
 *  `md` transparently. Pure → kept out of the component. */
export function blockMarkdown(b: DocBlock): string {
  if (b.type === 'h2') return `## ${b.text ?? ''}`;
  if (b.type === 'quote') return `> ${b.text ?? ''}`;
  if (b.type === 'bullets') return (b.items ?? []).map((i) => `- ${i}`).join('\n');
  return b.text ?? '';
}

/** What committing `text` to a block should do, decided purely so it can be tested
 *  and so the hook only carries the id/timestamp side effects. */
export type BlockEdit =
  | { kind: 'remove' }
  /** No change — leave the block exactly as-is (don't rewrite or migrate it). */
  | { kind: 'noop' }
  /** Store the body as a single `md` block (migrating a legacy type if needed). */
  | { kind: 'replace'; text: string }
  /** Body spans a blank line — fan out into separate blocks (first keeps the id). */
  | { kind: 'split'; parts: string[] };

/**
 * Resolve a block edit's raw Markdown against the block's current value. Runs on the
 * final flush only (see `use-doc`), so the blank-line split happens on blur, never
 * mid-typing. Crucially a **no-op touch** — opening a block and leaving without an
 * edit, so `text` still equals the block's projection — returns `noop`, so it never
 * rewrites the block or silently migrates a legacy `h2`/`quote`/`bullets` to `md`.
 */
export function planBlockEdit(existing: DocBlock | undefined, text: string): BlockEdit {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'remove' };
  const parts = splitMarkdownBlocks(trimmed);
  if (parts.length > 1) return { kind: 'split', parts };
  if (existing && blockMarkdown(existing) === text) return { kind: 'noop' };
  return { kind: 'replace', text: trimmed };
}
