import { describe, expect, it } from 'vitest';

// markdown.ts is pure (it only imports the pure message-format tokenizer), so it
// runs under Node with no module stubs — like message-format.test.ts.
import { parseInline, parseMarkdown, splitMarkdownBlocks, type InlineToken } from './markdown';

describe('splitMarkdownBlocks', () => {
  it('splits on blank lines', () => {
    expect(splitMarkdownBlocks('a\n\nb\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('collapses runs of blank lines (no empty blocks)', () => {
    expect(splitMarkdownBlocks('a\n\n\n\nb')).toEqual(['a', 'b']);
  });

  it('keeps a multi-line paragraph together', () => {
    expect(splitMarkdownBlocks('line one\nline two')).toEqual(['line one\nline two']);
  });

  // The load-bearing invariant: a fenced block legitimately contains blank lines,
  // so blank-line splitting must NOT tear it apart.
  it('keeps blank lines inside a fence as ONE block', () => {
    const src = '```ts\nconst a = 1\n\nconst b = 2\n```';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('separates a fence from surrounding prose', () => {
    expect(splitMarkdownBlocks('before\n```\ncode\n```\nafter')).toEqual(['before', '```\ncode\n```', 'after']);
  });

  it('keeps an unterminated fence as a single trailing block (graceful)', () => {
    expect(splitMarkdownBlocks('intro\n\n```\nopen code\nstill open')).toEqual(['intro', '```\nopen code\nstill open']);
  });

  it('returns nothing for whitespace-only input', () => {
    expect(splitMarkdownBlocks('   \n\n')).toEqual([]);
  });
});

describe('parseMarkdown', () => {
  it('classifies a heading with its level', () => {
    expect(parseMarkdown('### Title')).toEqual([{ type: 'heading', level: 3, text: 'Title' }]);
  });

  it('treats a hash run longer than 6 as a paragraph', () => {
    expect(parseMarkdown('####### nope')).toEqual([{ type: 'paragraph', text: '####### nope' }]);
  });

  it('classifies an unordered list', () => {
    expect(parseMarkdown('- one\n- two\n* three')).toEqual([{ type: 'bullets', items: ['one', 'two', 'three'] }]);
  });

  it('classifies an ordered list', () => {
    expect(parseMarkdown('1. one\n2. two')).toEqual([{ type: 'ordered', items: ['one', 'two'] }]);
  });

  it('classifies a blockquote, stripping the marker', () => {
    expect(parseMarkdown('> quoted\n> lines')).toEqual([{ type: 'quote', text: 'quoted\nlines' }]);
  });

  it('reads a fenced code block with its language hint', () => {
    expect(parseMarkdown('```ts\nconst x = 1\n```')).toEqual([{ type: 'code', value: 'const x = 1', lang: 'ts' }]);
  });

  it('parses a mixed document into ordered blocks', () => {
    const doc = '# H1\n\nA paragraph.\n\n- a\n- b\n\n```\ncode\n```';
    expect(parseMarkdown(doc)).toEqual([
      { type: 'heading', level: 1, text: 'H1' },
      { type: 'paragraph', text: 'A paragraph.' },
      { type: 'bullets', items: ['a', 'b'] },
      { type: 'code', value: 'code' },
    ]);
  });
});

describe('parseInline', () => {
  const tag = (t: InlineToken): string => {
    switch (t.type) {
      case 'text':
        return JSON.stringify(t.value);
      case 'strong':
        return `**${t.value}**`;
      case 'em':
        return `*${t.value}*`;
      case 'code':
        return `\`${t.value}\``;
      case 'link':
        return `[${t.label}](${t.url})`;
    }
  };
  const tags = (s: string): string => parseInline(s).map(tag).join(' ');

  it('keeps plain text as a single text token', () => {
    expect(parseInline('just words')).toEqual([{ type: 'text', value: 'just words' }]);
  });

  it('parses bold, italic and inline code', () => {
    expect(tags('a **b** and *c* and `d`')).toBe('"a " **b** " and " *c* " and " `d`');
  });

  it('treats _underscore_ as italic', () => {
    expect(tags('_em_')).toBe('*em*');
  });

  it('parses an explicit link', () => {
    expect(parseInline('see [docs](https://x.dev)')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', label: 'docs', url: 'https://x.dev' },
    ]);
  });

  it('leaves a stray asterisk as literal text (graceful)', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', value: '2 * 3 = 6' }]);
  });

  it('keeps an empty emphasis pair literal', () => {
    expect(parseInline('**')).toEqual([{ type: 'text', value: '**' }]);
  });
});
