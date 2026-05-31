/**
 * Message-body code formatting — a pure parser (no React) that splits a raw
 * message string into an ordered run of typed tokens for the renderer to lay
 * out. Markdown-lite: only code is recognized here (links/mentions stay the job
 * of `linkify` in `links.ts`, applied to the `text` tokens downstream).
 *
 *   - `` `code` ``         → inline code  (`{ type: 'code' }`)
 *   - ```` ```ts\n…\n``` ```` → fenced block (`{ type: 'codeblock', lang? }`)
 *
 * Triple-backtick fences take precedence over single backticks, so backticks
 * inside a fence are kept verbatim. Unmatched / trailing backticks degrade to
 * literal text rather than throwing, so any user input renders.
 */

/** A flat, ordered piece of a parsed message body. */
export type BodyToken =
  | { type: 'text'; value: string }
  /** Inline `` `code` `` — a monospace span on its prose line. */
  | { type: 'code'; value: string }
  /** A fenced ```` ``` ```` block; `lang` is the optional opening-fence hint. */
  | { type: 'codeblock'; value: string; lang?: string };

const FENCE = '```';

/** Drop exactly one leading and one trailing newline around a fence's body so
 *  the ```` ``` ```` delimiters sit on their own lines without adding blank rows,
 *  while interior indentation/whitespace is preserved (never `.trim()`). */
function trimFenceBody(body: string): string {
  let out = body;
  if (out.startsWith('\n')) out = out.slice(1);
  else if (out.startsWith('\r\n')) out = out.slice(2);
  if (out.endsWith('\n')) out = out.slice(0, out.endsWith('\r\n') ? -2 : -1);
  return out;
}

/** Push a text token, merging into a trailing text token so runs stay contiguous. */
function pushText(tokens: BodyToken[], value: string): void {
  if (!value) return;
  const last = tokens[tokens.length - 1];
  if (last?.type === 'text') last.value += value;
  else tokens.push({ type: 'text', value });
}

/**
 * Parse a raw message body into an ordered array of {@link BodyToken}s. Always
 * returns at least one token for a non-empty input; an empty string yields `[]`.
 */
export function parseMessageBody(body: string): BodyToken[] {
  const tokens: BodyToken[] = [];
  let i = 0;
  const n = body.length;

  while (i < n) {
    const fence = body.indexOf(FENCE, i);
    const tick = body.indexOf('`', i);

    // No backtick at all ahead → the rest is plain text.
    if (tick === -1) {
      pushText(tokens, body.slice(i));
      break;
    }

    // A fence wins over a lone backtick when it's the next thing we hit.
    if (fence !== -1 && fence === tick) {
      const close = body.indexOf(FENCE, fence + FENCE.length);
      if (close !== -1) {
        pushText(tokens, body.slice(i, fence));
        // The opening-fence line may carry a language hint: ```ts\n…  . The hint
        // only exists when a newline separates it from the body — a single-line
        // ```code``` has no hint, the whole inner run is the code.
        const inner = body.slice(fence + FENCE.length, close);
        const nl = inner.indexOf('\n');
        const lang = nl === -1 ? '' : inner.slice(0, nl).trim();
        const value = trimFenceBody(nl === -1 ? inner : inner.slice(nl));
        tokens.push({ type: 'codeblock', value, ...(lang ? { lang } : {}) });
        i = close + FENCE.length;
        continue;
      }
      // Unterminated fence → keep the literal backticks as text and move past
      // them so a later single-backtick pair can still match.
      pushText(tokens, body.slice(i, fence + FENCE.length));
      i = fence + FENCE.length;
      continue;
    }

    // Inline code: a single-backtick pair on the same body.
    const end = body.indexOf('`', tick + 1);
    if (end === -1) {
      // Unmatched backtick → literal text through the end.
      pushText(tokens, body.slice(i));
      break;
    }
    const code = body.slice(tick + 1, end);
    pushText(tokens, body.slice(i, tick));
    // An empty `` is a no-op pair → keep it literal rather than emitting a blank span.
    if (code === '') pushText(tokens, '``');
    else tokens.push({ type: 'code', value: code });
    i = end + 1;
  }

  return tokens;
}

/** Whether a token flows inline within a prose paragraph (vs. its own block).
 *  Text and inline `` `code` `` are inline; a fenced ```` ``` ```` block is not. */
export const isInlineToken = (t: BodyToken): boolean => t.type !== 'codeblock';

/**
 * Group a flat {@link BodyToken} run into render groups: consecutive inline
 * tokens (text + inline code) collapse into one paragraph group so they wrap as
 * a single flowing line, while each fenced block stands alone in its own group.
 * Pure layout logic kept out of the renderer.
 */
export function groupBodyTokens(tokens: BodyToken[]): BodyToken[][] {
  const groups: BodyToken[][] = [];
  for (const token of tokens) {
    const last = groups[groups.length - 1];
    if (isInlineToken(token) && last && isInlineToken(last[0])) last.push(token);
    else groups.push([token]);
  }
  return groups;
}
