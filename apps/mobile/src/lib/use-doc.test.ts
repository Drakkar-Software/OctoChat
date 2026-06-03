import { describe, expect, it } from 'vitest';

import { blockMarkdown, planBlockEdit, type DocBlock } from './doc-block';

/** Build a DocBlock with the structural fields filled in; the projection only
 *  reads `type`/`text`/`items`. */
function block(partial: Partial<DocBlock> & Pick<DocBlock, 'type'>): DocBlock {
  return { id: 'b1', order: 0, updatedAt: 0, ...partial };
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

describe('planBlockEdit', () => {
  it('removes the block when the body is blank', () => {
    expect(planBlockEdit(block({ type: 'md', text: 'x' }), '')).toEqual({ kind: 'remove' });
    expect(planBlockEdit(block({ type: 'md', text: 'x' }), '   \n ')).toEqual({ kind: 'remove' });
  });

  it('is a no-op when the body still equals the block projection — no rewrite on tap-in/tap-out', () => {
    expect(planBlockEdit(block({ type: 'md', text: 'hello' }), 'hello')).toEqual({ kind: 'noop' });
  });

  it('NEVER migrates a legacy block on a no-op touch (regression: finalizeAlways forced editBlock)', () => {
    // Opening these and leaving without an edit must not coerce them to `md` / drop items.
    expect(planBlockEdit(block({ type: 'h2', text: 'Section' }), '## Section')).toEqual({ kind: 'noop' });
    expect(planBlockEdit(block({ type: 'quote', text: 'q' }), '> q')).toEqual({ kind: 'noop' });
    expect(planBlockEdit(block({ type: 'bullets', items: ['a', 'b'] }), '- a\n- b')).toEqual({ kind: 'noop' });
  });

  it('does not rewrite an md block whose stored text carries trailing whitespace on a no-op touch', () => {
    // The editor is seeded with the projection, so a no-op flush passes that exact text back.
    expect(planBlockEdit(block({ type: 'md', text: 'hi\n' }), 'hi\n')).toEqual({ kind: 'noop' });
  });

  it('replaces (and migrates a legacy block to md) on an actual single-block edit', () => {
    expect(planBlockEdit(block({ type: 'md', text: 'hello' }), 'hello world')).toEqual({ kind: 'replace', text: 'hello world' });
    // a real edit to a legacy block: now it migrates, as intended
    expect(planBlockEdit(block({ type: 'h2', text: 'Section' }), '## Section!')).toEqual({ kind: 'replace', text: '## Section!' });
  });

  it('trims the replacement body', () => {
    expect(planBlockEdit(block({ type: 'md', text: 'a' }), '  b  ')).toEqual({ kind: 'replace', text: 'b' });
  });

  it('splits a blank-line body into parts (first part keeps the id downstream)', () => {
    const plan = planBlockEdit(block({ type: 'md', text: 'A' }), 'A\n\nB\n\nC');
    expect(plan.kind).toBe('split');
    expect(plan).toEqual({ kind: 'split', parts: ['A', 'B', 'C'] });
  });

  it('creating a brand-new block (no existing) with a single line replaces', () => {
    expect(planBlockEdit(undefined, 'first line')).toEqual({ kind: 'replace', text: 'first line' });
  });
});
