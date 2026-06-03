import { describe, expect, it } from 'vitest';

import { blockMarkdown, joinBlocks, mergeDocEdit, type DocBlock } from './doc-block';

/** Build a DocBlock with the structural fields filled in; the projection only
 *  reads `type`/`text`/`items`. */
function block(partial: Partial<DocBlock> & Pick<DocBlock, 'type'>): DocBlock {
  return { id: 'b1', order: 0, updatedAt: 0, ...partial };
}

/** A deterministic id minter for reconcileDoc tests (no CSPRNG in node). */
function idGen() {
  let n = 0;
  return () => `new-${++n}`;
}

/** Shorthand: build an `md` block. */
function md(id: string, text: string, order: number, updatedAt = 0): DocBlock {
  return { id, type: 'md', text, order, updatedAt };
}

describe('blockMarkdown', () => {
  it('passes an md block through verbatim', () => {
    expect(blockMarkdown(block({ type: 'md', text: '# Title\n\nbody **bold**' }))).toBe('# Title\n\nbody **bold**');
  });

  it('lifts a legacy h2 block to a Markdown heading', () => {
    expect(blockMarkdown(block({ type: 'h2', text: 'Section' }))).toBe('## Section');
  });

  it('lifts a legacy quote block to a Markdown blockquote', () => {
    expect(blockMarkdown(block({ type: 'quote', text: 'Remember this' }))).toBe('> Remember this');
  });

  it('lifts a legacy bullets block to a Markdown list', () => {
    expect(blockMarkdown(block({ type: 'bullets', items: ['one', 'two', 'three'] }))).toBe('- one\n- two\n- three');
  });

  it('projects a paragraph (legacy `p`) via its text', () => {
    expect(blockMarkdown(block({ type: 'p', text: 'a paragraph' }))).toBe('a paragraph');
  });

  it('falls back to empty string when text is missing', () => {
    expect(blockMarkdown(block({ type: 'md' }))).toBe('');
    expect(blockMarkdown(block({ type: 'h2' }))).toBe('## ');
    expect(blockMarkdown(block({ type: 'quote' }))).toBe('> ');
  });

  it('projects empty bullets to an empty string (no stray dash)', () => {
    expect(blockMarkdown(block({ type: 'bullets' }))).toBe('');
    expect(blockMarkdown(block({ type: 'bullets', items: [] }))).toBe('');
  });
});

describe('joinBlocks', () => {
  it('joins blocks (sorted by order) into one Markdown string, blank line between', () => {
    expect(joinBlocks([md('b', 'B', 1), md('a', 'A', 0), md('c', 'C', 2)])).toBe('A\n\nB\n\nC');
  });

  it('breaks order ties by id so the join is stable', () => {
    expect(joinBlocks([md('b', 'B', 0), md('a', 'A', 0)])).toBe('A\n\nB');
  });

  it('projects legacy blocks through blockMarkdown', () => {
    expect(joinBlocks([block({ id: 'h', type: 'h2', text: 'Title', order: 0 }), md('p', 'body', 1)])).toBe('## Title\n\nbody');
  });
});

describe('mergeDocEdit (single device — base === current)', () => {
  const opts = () => ({ now: 100, newId: idGen() });
  /** Single-device edit: the merge base is the same list as the live blocks. */
  const edit = (blocks: DocBlock[], text: string) => mergeDocEdit(blocks, blocks, text, opts());
  // Sort like the hook does, so order assertions read in document order.
  const inOrder = (blocks: DocBlock[]) => blocks.slice().sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));

  it('is a no-op when the text projects to the same paragraphs (round-trip stability)', () => {
    const old = [md('a', 'A', 0), md('b', 'B', 1)];
    const res = edit(old, joinBlocks(old));
    expect(res.changed).toBe(false);
    expect(res.blocks).toBe(old); // same array, no churn
  });

  it('is idempotent — merging the projected text again yields zero writes', () => {
    const old = [md('a', 'A', 0)];
    const first = edit(old, 'A\n\nB\n\nC');
    expect(first.changed).toBe(true);
    const second = edit(first.blocks, joinBlocks(first.blocks));
    expect(second.changed).toBe(false);
    expect(second.blocks).toBe(first.blocks);
  });

  it('edits one paragraph: that block keeps its id+order (updatedAt bumps), others untouched', () => {
    const a = md('a', 'A', 0);
    const b = md('b', 'B', 1, 5);
    const c = md('c', 'C', 2);
    const res = edit([a, b, c], 'A\n\nB2\n\nC');
    expect(res.changed).toBe(true);
    const byId = Object.fromEntries(res.blocks.map((x) => [x.id, x]));
    expect(res.blocks.find((x) => x.id === 'a')).toBe(a); // no-op, same reference
    expect(res.blocks.find((x) => x.id === 'c')).toBe(c);
    expect(byId.b).toEqual({ id: 'b', type: 'md', text: 'B2', order: 1, updatedAt: 100 });
  });

  it('inserts a paragraph at the top: existing ids preserved (NOT all re-minted)', () => {
    const a = md('a', 'A', 0);
    const res = edit([a], 'X\n\nA');
    expect(res.blocks.find((x) => x.id === 'a')).toBe(a); // A untouched
    const x = res.blocks.find((x) => x.id !== 'a')!;
    expect(x.text).toBe('X');
    expect(joinBlocks(res.blocks)).toBe('X\n\nA');
  });

  it('inserts a paragraph at the bottom, keeping the existing one a no-op', () => {
    const a = md('a', 'A', 0);
    const res = edit([a], 'A\n\nY');
    expect(res.blocks.find((x) => x.id === 'a')).toBe(a);
    expect(joinBlocks(res.blocks)).toBe('A\n\nY');
  });

  it('deletes a middle paragraph: that id is dropped, neighbours are no-ops', () => {
    const a = md('a', 'A', 0);
    const b = md('b', 'B', 1);
    const c = md('c', 'C', 2);
    const res = edit([a, b, c], 'A\n\nC');
    expect(res.changed).toBe(true);
    expect(res.blocks.map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(res.blocks.find((x) => x.id === 'a')).toBe(a);
    expect(res.blocks.find((x) => x.id === 'c')).toBe(c);
  });

  it('splits one paragraph into two: original id kept for the first, one new id', () => {
    const a = md('a', 'A', 0);
    const b = md('b', 'B', 1);
    const c = md('c', 'C', 2);
    const res = edit([a, b, c], 'A\n\nB1\n\nB2\n\nC');
    expect(joinBlocks(res.blocks)).toBe('A\n\nB1\n\nB2\n\nC');
    const b1 = res.blocks.find((x) => x.id === 'b')!;
    expect(b1.text).toBe('B1'); // original id kept for the first piece
    expect(res.blocks.filter((x) => x.id.startsWith('new-'))).toHaveLength(1);
  });

  it('merges two paragraphs into one: one id kept, the other deleted', () => {
    const a = md('a', 'A', 0);
    const b = md('b', 'B', 1);
    const c = md('c', 'C', 2);
    const res = edit([a, b, c], 'A\n\nBC');
    expect(joinBlocks(res.blocks)).toBe('A\n\nBC');
    expect(res.blocks.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(res.blocks.find((x) => x.id === 'b')!.text).toBe('BC');
  });

  it('clearing the whole doc removes every block', () => {
    const res = edit([md('a', 'A', 0), md('b', 'B', 1)], '   \n\n ');
    expect(res.changed).toBe(true);
    expect(res.blocks).toEqual([]);
  });

  it('writing into an empty doc creates fresh md blocks', () => {
    const res = edit([], 'first\n\nsecond');
    expect(inOrder(res.blocks).map((x) => x.text)).toEqual(['first', 'second']);
    expect(res.blocks.every((x) => x.type === 'md' && x.id.startsWith('new-'))).toBe(true);
  });

  it('keeps an untouched legacy block verbatim while editing a sibling (no forced migration)', () => {
    const h = block({ id: 'h', type: 'h2', text: 'Section', order: 0 });
    const p = md('p', 'body', 1);
    const res = edit([h, p], '## Section\n\nbody!');
    expect(res.blocks.find((x) => x.id === 'h')).toBe(h); // legacy h2 untouched
    expect(res.blocks.find((x) => x.id === 'p')!.text).toBe('body!');
  });

  it('keeps a fenced code block (with blank lines) as one block', () => {
    const code = 'A\n\n```\nx = 1\n\ny = 2\n```\n\nB';
    const res = edit([], code);
    expect(inOrder(res.blocks).map((x) => x.text)).toEqual(['A', '```\nx = 1\n\ny = 2\n```', 'B']);
    expect(edit(res.blocks, joinBlocks(res.blocks)).changed).toBe(false); // round-trips
  });
});

describe('mergeDocEdit (3-way — concurrent edits to different paragraphs survive)', () => {
  const opts = () => ({ now: 100, newId: idGen() });

  it('does NOT clobber another device’s edit to a paragraph this user never touched', () => {
    // Base when the editor opened.
    const base = [md('p1', 'P1', 0), md('p2', 'P2', 1), md('p3', 'P3', 2)];
    // Live blocks at flush: device B has already edited P3 (a paragraph A never touched).
    const current = [md('p1', 'P1', 0), md('p2', 'P2', 1), md('p3', 'P3edited', 2, 9)];
    // Device A only changed P1.
    const res = mergeDocEdit(current, base, 'P1edited\n\nP2\n\nP3', opts());
    const byId = Object.fromEntries(res.blocks.map((x) => [x.id, x]));
    expect(byId.p1).toMatchObject({ text: 'P1edited', updatedAt: 100 }); // A's edit applied
    expect(byId.p3).toEqual({ id: 'p3', type: 'md', text: 'P3edited', order: 2, updatedAt: 9 }); // B's edit survives
    expect(byId.p2).toMatchObject({ text: 'P2', updatedAt: 0 }); // untouched
  });

  it('a no-op flush (this user typed nothing) keeps the other device’s concurrent edit', () => {
    const base = [md('p1', 'P1', 0), md('p2', 'P2', 1)];
    const current = [md('p1', 'P1edited', 0, 9), md('p2', 'P2', 1)];
    const res = mergeDocEdit(current, base, joinBlocks(base), opts());
    expect(res.changed).toBe(false);
    expect(res.blocks).toBe(current); // B's edit untouched
  });

  it('this user’s insert lands alongside the other device’s concurrent edit', () => {
    const base = [md('p1', 'P1', 0), md('p2', 'P2', 1)];
    const current = [md('p1', 'P1edited', 0, 9), md('p2', 'P2', 1)];
    // A inserts a paragraph between P1 and P2.
    const res = mergeDocEdit(current, base, 'P1\n\nNEW\n\nP2', opts());
    const byId = Object.fromEntries(res.blocks.map((x) => [x.id, x]));
    expect(byId.p1).toMatchObject({ text: 'P1edited', updatedAt: 9 }); // B's edit survives; A didn't touch P1
    const inserted = res.blocks.find((x) => x.id.startsWith('new-'))!;
    expect(inserted.text).toBe('NEW');
    expect(inserted.order).toBeGreaterThan(0);
    expect(inserted.order).toBeLessThan(1);
  });
});

describe('mergeDocEdit (base lifecycle — advancing nextBase across debounce ticks)', () => {
  it('a multi-tick insert advances the base and never duplicates the typed paragraph', () => {
    const o = { now: 100, newId: idGen() };
    const base0 = [md('a', 'A', 0)];
    // Tick 1: type a new paragraph.
    const r1 = mergeDocEdit(base0, base0, 'A\n\nNEW', o);
    expect(r1.blocks).toHaveLength(2);
    // Tick 2: keep typing — DocView feeds back r1.nextBase as the new base.
    const r2 = mergeDocEdit(r1.blocks, r1.nextBase, 'A\n\nNEWx', o);
    expect(r2.blocks).toHaveLength(2); // edit-in-place, NOT a second insert
    expect(joinBlocks(r2.blocks)).toBe('A\n\nNEWx');
    // Guard: reusing the FROZEN base0 instead would re-mint → the duplicate-block bug.
    const frozen = mergeDocEdit(r1.blocks, base0, 'A\n\nNEWx', o);
    expect(frozen.blocks).toHaveLength(3);
  });

  it('a concurrent edit by another device survives a multi-tick insert (no dup, B preserved)', () => {
    const o = { now: 100, newId: idGen() };
    const base0 = [md('p1', 'P1', 0), md('p2', 'P2', 1)];
    // Tick 1: A inserts a paragraph between P1 and P2.
    const r1 = mergeDocEdit(base0, base0, 'P1\n\nNEW\n\nP2', o);
    // Device B edits P2 in the live storage while A is still typing.
    const afterB = r1.blocks.map((b) => (b.id === 'p2' ? md('p2', 'P2edited', b.order, 9) : b));
    // Tick 2: A extends the new paragraph; base advances to r1.nextBase.
    const r2 = mergeDocEdit(afterB, r1.nextBase, 'P1\n\nNEWER\n\nP2', o);
    const byId = Object.fromEntries(r2.blocks.map((x) => [x.id, x]));
    expect(byId.p2).toMatchObject({ text: 'P2edited', updatedAt: 9 }); // B preserved
    const inserts = r2.blocks.filter((x) => x.id.startsWith('new-'));
    expect(inserts).toHaveLength(1); // no duplicate
    expect(inserts[0]!.text).toBe('NEWER');
    expect(joinBlocks(r2.blocks)).toBe('P1\n\nNEWER\n\nP2edited');
  });
});
