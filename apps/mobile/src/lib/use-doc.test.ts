import { describe, expect, it } from 'vitest';

import { blockMarkdown, type DocBlock } from './doc-block';

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
