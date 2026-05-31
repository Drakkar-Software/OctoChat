import { describe, expect, it } from 'vitest';

// message-format.ts is pure (no React / react-native imports), so it runs under
// Node with no module stubs — unlike links.test.ts which mocks expo-router.
import { groupBodyTokens, parseMessageBody, type BodyToken } from './message-format';

// Compact a token to a readable, order-sensitive tag for assertions.
const tag = (t: BodyToken): string =>
  t.type === 'text'
    ? JSON.stringify(t.value)
    : t.type === 'code'
      ? `\`${t.value}\``
      : `BLOCK[${t.lang ?? ''}]${JSON.stringify(t.value)}`;
const tags = (input: string): string => parseMessageBody(input).map(tag).join(' ');

describe('parseMessageBody', () => {
  it('returns nothing for an empty string', () => {
    expect(parseMessageBody('')).toEqual([]);
  });

  it('returns one text token when nothing is code', () => {
    expect(parseMessageBody('plain text')).toEqual([{ type: 'text', value: 'plain text' }]);
  });

  it('parses an inline code span', () => {
    expect(tags('run `npm i` now')).toBe('"run " `npm i` " now"');
  });

  it('parses two inline spans on one line', () => {
    expect(tags('`a` and `b`')).toBe('`a` " and " `b`');
  });

  it('parses a fenced block', () => {
    expect(parseMessageBody('```\ncode here\n```')).toEqual([{ type: 'codeblock', value: 'code here' }]);
  });

  it('reads a language hint off the opening fence', () => {
    expect(parseMessageBody('```ts\nconst x = 1\n```')).toEqual([
      { type: 'codeblock', value: 'const x = 1', lang: 'ts' },
    ]);
  });

  it('keeps interior whitespace/indentation in a fence (no full trim)', () => {
    expect(parseMessageBody('```\n  indented\n    more\n```')).toEqual([
      { type: 'codeblock', value: '  indented\n    more' },
    ]);
  });

  it('trims only the single leading + trailing newline of a fence', () => {
    expect(parseMessageBody('```\n\nx\n\n```')).toEqual([{ type: 'codeblock', value: '\nx\n' }]);
  });

  it('keeps text around a fenced block in order', () => {
    expect(tags('before\n```\nx\n```\nafter')).toBe('"before\\n" BLOCK[]"x" "\\nafter"');
  });

  it('lets fences win over single backticks (backtick inside a fence is literal)', () => {
    expect(parseMessageBody('```\na `b` c\n```')).toEqual([{ type: 'codeblock', value: 'a `b` c' }]);
  });

  it('renders an unmatched trailing backtick as literal text', () => {
    expect(parseMessageBody('a single ` tick')).toEqual([{ type: 'text', value: 'a single ` tick' }]);
  });

  it('renders an unterminated fence as literal text', () => {
    expect(parseMessageBody('```\nno close')).toEqual([{ type: 'text', value: '```\nno close' }]);
  });

  it('treats an empty `` as literal backticks, not an empty code span', () => {
    expect(parseMessageBody('a `` b')).toEqual([{ type: 'text', value: 'a `` b' }]);
  });

  it('handles a single-line fence with no inner newlines', () => {
    expect(parseMessageBody('```inline only```')).toEqual([{ type: 'codeblock', value: 'inline only' }]);
  });
});

describe('groupBodyTokens', () => {
  // Map a group run to a compact shape so order + grouping is easy to assert.
  const shape = (input: string): string[] =>
    groupBodyTokens(parseMessageBody(input)).map((g) => g.map((t) => t.type).join('+'));

  it('returns no groups for an empty body', () => {
    expect(groupBodyTokens([])).toEqual([]);
  });

  it('keeps text + inline code in a single paragraph group', () => {
    expect(shape('run `a` and `b` ok')).toEqual(['text+code+text+code+text']);
  });

  it('breaks each fenced block into its own group', () => {
    expect(shape('before\n```\nx\n```\nafter')).toEqual(['text', 'codeblock', 'text']);
  });

  it('does not merge inline runs separated by a fenced block', () => {
    expect(shape('a `b`\n```\nc\n```\nd `e`')).toEqual(['text+code+text', 'codeblock', 'text+code']);
  });

  it('keeps adjacent fenced blocks as separate groups', () => {
    const blocks: BodyToken[] = [
      { type: 'codeblock', value: 'a' },
      { type: 'codeblock', value: 'b' },
    ];
    expect(groupBodyTokens(blocks)).toEqual([[blocks[0]], [blocks[1]]]);
  });
});
