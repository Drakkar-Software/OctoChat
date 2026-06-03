/**
 * Doc block model + Markdown projection — pure (no React, no I/O), the twin of
 * {@link foldProject} in `project-board.ts`. Kept out of `use-doc.ts` so it imports
 * (and tests) without pulling the merge-doc / React Native machinery.
 */
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
