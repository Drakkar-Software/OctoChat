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

/** Join a block list back into one Markdown string — the inverse of {@link reconcileDoc}'s
 *  split. Blocks sort by `(order, id)` then project to Markdown joined by a blank line, so
 *  `splitMarkdownBlocks(joinBlocks(b))` recovers exactly one source per block (the round-trip
 *  the seamless editor relies on). This is what the editor seeds with and renders. */
export function joinBlocks(blocks: DocBlock[]): string {
  return blocks
    .slice()
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1))
    .map(blockMarkdown)
    .join('\n\n');
}

/** Longest-common-subsequence index pairs `[oldIdx, newIdx]` (increasing in both),
 *  by exact string equality. The matched pairs are the paragraphs the user did NOT
 *  touch; everything between consecutive pairs is an edit/insert/delete to reconcile. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** An entry in the edited doc, in final (new-text) order: either an anchor (a paragraph
 *  backed by a base block — kept or edited in place) or a freshly inserted paragraph. The
 *  insert's `id` is filled in once minted, so `nextBase` can carry it forward. */
type SeqEntry = { kind: 'anchor'; id: ID } | { kind: 'insert'; text: string; id?: ID };

const byOrder = (a: DocBlock, b: DocBlock) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1);

/**
 * Merge one device's whole-doc text edit back into the live merge blocks — the heart of
 * the seamless ("no visible blocks") editor. The user edits ONE textarea over the entire
 * doc; storage stays paragraph-blocks purely so two devices editing DIFFERENT paragraphs
 * both survive the union-merge. Getting that right under concurrency needs a **3-way**
 * merge, not a 2-way reconcile:
 *
 *  - `base` is the block list captured when the editor OPENED (what the user's text was
 *    seeded from). `newText` is what they typed. `current` is the LIVE block list at flush
 *    time — which may already contain another device's edits pulled in over SSE while the
 *    editor was open.
 *  - Diffing `base → newText` (by LCS over paragraph projections) isolates the paragraphs
 *    THIS user actually changed/inserted/deleted. ONLY those are written onto `current`;
 *    every other block in `current` (including the other device's concurrent edits, and
 *    paragraphs this user never touched) is left byte-identical. That is what preserves
 *    merge granularity — a 2-way `reconcile(current, newText)` would instead treat the
 *    other device's edit as "something the user changed" and clobber it via LWW.
 *
 * Properties (all tested): unchanged paragraphs are never written (no `updatedAt` churn);
 * a no-edit flush is a pure no-op returning `current` (so re-saving every debounce tick is
 * safe — no latch); an edit keeps its block id (and its order); inserts get fractional
 * orders between their neighbours. (A wholesale paragraph reorder via raw text may not
 * perfectly preserve every order but self-heals on the next edit; edit/insert/delete/
 * split/merge are exact.)
 *
 * Returns `nextBase` — the user's OWN view of the doc after this edit — which the editor
 * MUST advance its merge base to after each commit. `base` is otherwise frozen at open;
 * leaving it frozen would re-mint a fresh id for a still-being-typed new paragraph on every
 * debounce tick, accumulating duplicate blocks. `nextBase` carries the minted insert ids
 * forward so the next tick matches them instead. Crucially it keeps untouched paragraphs at
 * their *base* (pre-other-device) text — NOT the merged storage — so they keep matching the
 * still-open editor text and a concurrent edit by another device is never re-clobbered.
 */
export function mergeDocEdit(
  current: DocBlock[],
  base: DocBlock[],
  newText: string,
  opts: { now: number; newId: () => ID },
): { blocks: DocBlock[]; changed: boolean; nextBase: DocBlock[] } {
  const baseSorted = base.slice().sort(byOrder);
  const baseParts = baseSorted.map(blockMarkdown);
  const newParts = splitMarkdownBlocks(newText);

  // This user changed nothing (text still projects to the base paragraphs) ⇒ keep `current`
  // verbatim. Crucial: never clobber the other device's concurrent edits on a no-op flush.
  if (newParts.length === baseParts.length && newParts.every((p, i) => p === baseParts[i])) {
    return { blocks: current, changed: false, nextBase: base };
  }

  const pairs = lcsPairs(baseParts, newParts);
  const baseById = new Map(baseSorted.map((b) => [b.id, b]));
  const curMap = new Map(current.map((b) => [b.id, b]));

  // Walk base↔new in new order, classifying each base block (kept / edited / deleted) and
  // each surplus new paragraph (inserted), keeping the new-order sequence for positioning.
  const seq: SeqEntry[] = [];
  const editedById = new Map<ID, string>();
  const deletedIds = new Set<ID>();
  const gap = (oStart: number, oEnd: number, nStart: number, nEnd: number) => {
    let o = oStart;
    for (let n = nStart; n < nEnd; n++) {
      if (o < oEnd) {
        const id = baseSorted[o]!.id; // base paragraph edited in place → keep its id
        editedById.set(id, newParts[n]!);
        seq.push({ kind: 'anchor', id });
        o++;
      } else {
        seq.push({ kind: 'insert', text: newParts[n]! }); // brand-new paragraph
      }
    }
    for (; o < oEnd; o++) deletedIds.add(baseSorted[o]!.id); // surplus base blocks were deleted
  };
  let oiPrev = -1;
  let njPrev = -1;
  for (const [oi, nj] of pairs) {
    gap(oiPrev + 1, oi, njPrev + 1, nj);
    seq.push({ kind: 'anchor', id: baseSorted[oi]!.id }); // unchanged paragraph
    oiPrev = oi;
    njPrev = nj;
  }
  gap(oiPrev + 1, baseSorted.length, njPrev + 1, newParts.length);

  if (editedById.size === 0 && deletedIds.size === 0 && !seq.some((s) => s.kind === 'insert')) {
    return { blocks: current, changed: false, nextBase: base };
  }

  // Apply the user's edits/deletes onto `current`; blocks the user didn't touch stay as
  // they are in `current` (preserving the other device's concurrent edits).
  for (const id of deletedIds) curMap.delete(id);
  for (const [id, text] of editedById) {
    const order = curMap.get(id)?.order ?? baseById.get(id)?.order ?? 0; // keep its place
    curMap.set(id, { id, type: 'md', text, order, updatedAt: opts.now });
  }

  // Inserts: position each run between the current orders of its surrounding anchors. The
  // minted id is recorded on the entry so `nextBase` can carry it forward (else the next
  // tick would re-mint and duplicate the just-typed paragraph).
  const orderOf = (id: ID): number | undefined => curMap.get(id)?.order ?? baseById.get(id)?.order;
  let i = 0;
  while (i < seq.length) {
    if (seq[i]!.kind !== 'insert') {
      i++;
      continue;
    }
    let j = i;
    while (j < seq.length && seq[j]!.kind === 'insert') j++;
    const prev = i > 0 ? seq[i - 1]! : undefined;
    const next = j < seq.length ? seq[j]! : undefined;
    const left = prev?.kind === 'anchor' ? orderOf(prev.id) : undefined;
    const right = next?.kind === 'anchor' ? orderOf(next.id) : undefined;
    const n = j - i;
    for (let k = 0; k < n; k++) {
      const entry = seq[i + k] as Extract<SeqEntry, { kind: 'insert' }>;
      let order: number;
      if (left === undefined && right === undefined) order = k;
      else if (left === undefined) order = right! - (n - k);
      else if (right === undefined) order = left + (k + 1);
      else order = left + ((right - left) * (k + 1)) / (n + 1);
      const id = opts.newId();
      entry.id = id;
      curMap.set(id, { id, type: 'md', text: entry.text, order, updatedAt: opts.now });
    }
    i = j;
  }

  // The user's own view after this edit (see the header): kept paragraphs at their base
  // text, edited/inserted paragraphs with their new text + the just-minted ids, sequential
  // orders so it projects straight back to the edited text.
  const nextBase: DocBlock[] = seq.map((s, idx) => {
    if (s.kind === 'insert') return { id: s.id!, type: 'md', text: s.text, order: idx, updatedAt: opts.now };
    const edited = editedById.get(s.id);
    if (edited !== undefined) return { id: s.id, type: 'md', text: edited, order: idx, updatedAt: opts.now };
    return { ...baseById.get(s.id)!, order: idx };
  });

  return { blocks: [...curMap.values()], changed: true, nextBase };
}
