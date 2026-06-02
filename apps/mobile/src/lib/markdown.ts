/**
 * Markdown — a pure parser (no React) that turns a raw Markdown string into an
 * ordered list of typed block tokens for the renderer to lay out, plus an inline
 * tokenizer for the prose inside a block. First-version Markdown: the common
 * subset (headings, lists, quote, fenced code, bold/italic/inline-code/links).
 *
 * Code handling is REUSED from {@link parseMessageBody} (chat's tokenizer) so the
 * app has ONE notion of `` `code` `` / ```` ``` ```` — this module imports it
 * one-directionally and never edits it. Bare URLs and `#channel` / `@user`
 * mentions are intentionally LEFT to `LinkText`/`linkify` downstream (applied to
 * the `text` inline tokens), so docs and chat mention the same way.
 *
 * Resilience mirrors `parseMessageBody`: malformed input never throws — an
 * unterminated fence or stray `*` degrades to literal text rather than tearing
 * the doc.
 */

import { parseMessageBody } from './message-format';

const FENCE = '```';

/** A block-level Markdown node. */
export type MdBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'ordered'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; value: string; lang?: string };

/** An inline span inside a block's prose. `text` runs still flow through
 *  `LinkText` downstream (URLs + `#`/`@` mentions); the rest are leaf spans. */
export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; url: string };

const isFenceLine = (line: string): boolean => line.trimStart().startsWith(FENCE);

/**
 * Split raw Markdown into block source strings on blank lines — **fence-aware**:
 * a ```` ``` ```` block legitimately contains blank lines, so blank-line breaks
 * only count OUTSIDE an open fence. An unterminated fence keeps the rest as one
 * block (graceful). This is the unit the doc editor stores per merge-block.
 */
export function splitMarkdownBlocks(src: string): string[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = () => {
    if (cur.length) blocks.push(cur.join('\n'));
    cur = [];
  };

  for (const line of lines) {
    const fenceHere = isFenceLine(line);
    if (!inFence && fenceHere) {
      flush(); // close any open prose block; the fence starts its own
      cur.push(line);
      inFence = true;
      continue;
    }
    if (inFence) {
      cur.push(line);
      if (fenceHere) {
        inFence = false; // closing fence ends the code block
        flush();
      }
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

/** Classify one block's source into a typed {@link MdBlock}. */
function classifyBlock(raw: string): MdBlock {
  const lines = raw.split('\n');

  if (isFenceLine(lines[0])) {
    const lang = lines[0].trimStart().slice(FENCE.length).trim();
    let body = lines.slice(1);
    if (body.length && isFenceLine(body[body.length - 1])) body = body.slice(0, -1);
    return { type: 'code', value: body.join('\n'), ...(lang ? { lang } : {}) };
  }

  const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
  if (heading && lines.length === 1) return { type: 'heading', level: heading[1].length, text: heading[2] };

  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length && nonEmpty.every((l) => /^\s*[-*+]\s+/.test(l)))
    return { type: 'bullets', items: nonEmpty.map((l) => l.replace(/^\s*[-*+]\s+/, '')) };
  if (nonEmpty.length && nonEmpty.every((l) => /^\s*\d+\.\s+/.test(l)))
    return { type: 'ordered', items: nonEmpty.map((l) => l.replace(/^\s*\d+\.\s+/, '')) };
  if (nonEmpty.length && nonEmpty.every((l) => /^\s*>\s?/.test(l)))
    return { type: 'quote', text: nonEmpty.map((l) => l.replace(/^\s*>\s?/, '')).join('\n') };

  return { type: 'paragraph', text: raw };
}

/** Parse a full Markdown string into ordered block tokens. */
export function parseMarkdown(src: string): MdBlock[] {
  return splitMarkdownBlocks(src).map(classifyBlock);
}

// `**bold**` | `*em*` | `_em_` | `[label](url)` — non-nested (each capture is a
// single run), so an empty `**`/`*`/`_` pair fails to match and stays literal.
const INLINE_RE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\))/g;

/** Tokenize emphasis + links within one prose run (already code-free). */
function tokenizeEmphasis(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[2] !== undefined) tokens.push({ type: 'strong', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: 'em', value: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: 'em', value: m[4] });
    else if (m[5] !== undefined && m[6] !== undefined) tokens.push({ type: 'link', label: m[5], url: m[6] });
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

/**
 * Parse a block's prose into inline tokens. Code spans come from
 * {@link parseMessageBody} (the shared chat tokenizer); the remaining text runs
 * are scanned for emphasis + explicit `[label](url)` links. Plain `text` tokens
 * are left for `LinkText` to linkify (URLs + `#`/`@` mentions).
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const t of parseMessageBody(text)) {
    if (t.type === 'text') tokens.push(...tokenizeEmphasis(t.value));
    else tokens.push({ type: 'code', value: t.value }); // inline `code` or a stray fence run
  }
  return tokens;
}
