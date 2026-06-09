/**
 * Pure, platform-agnostic prompt builders for both on-device AI features.
 * No imports of expo-ai-kit or React — safe everywhere, unit-testable.
 */
import type { StoredMsg } from '@drakkar.software/octochat-sdk';
import type { LLMMessage } from './ai-engine';

/** Char budget for the conversation context fed to a reply suggestion. Rather than
 *  a fixed turn count, include as many recent non-empty messages as fit, so the
 *  model sees the fullest conversation its (small) context window allows. */
export const SUGGESTION_MAX_CHARS = 4000;

/** Max chars of unread message text to include in a "catch me up" summary.
 *  Built-in models (Apple FM) have a small context window; Gemma 8–16k. */
export const SUMMARY_MAX_CHARS = 6000;

/** Max chars of already-read lead-in context to include alongside the unread. */
export const SUMMARY_CONTEXT_MAX_CHARS = 1500;

/** How many recent already-read messages to include as lead-in context, so the
 *  unread summary can reference what came just before it. */
export const SUMMARY_CONTEXT_TURNS = 10;

/** The next action the on-device model can suggest, reacting to the last message.
 *  `reply` fills the composer; `react`/`pin` act on the message directly; `thread`
 *  opens a focused thread, optionally pre-seeded with `text` (the "thread + answer"
 *  combo). */
export type SuggestionAction =
  | { kind: 'reply'; text: string }
  | { kind: 'react'; emoji: string }
  | { kind: 'thread'; text?: string }
  | { kind: 'pin' };

/** Which non-reply actions are available in the current surface — `thread` is off
 *  inside a thread (no nesting), `pin` is owner-only. The prompt only lists the
 *  actions that are actually wired, so the model can't suggest a dead one. */
export interface SuggestionCaps {
  canThread: boolean;
  canPin: boolean;
}

const SUGGEST_ACTION_KEYWORDS = ['REPLY', 'REACT', 'THREAD', 'PIN'] as const;

/** The emoji a REACT suggestion carries: the first whitespace-delimited token,
 *  kept whole (so ZWJ sequences / skin-tone modifiers survive), rejected when it's
 *  plainly text (letters/digits/punctuation only) rather than a glyph. */
function firstEmoji(s: string): string | null {
  const tok = s.trim().split(/\s+/)[0] ?? '';
  if (!tok || /^[\p{L}\p{N}\p{P}]+$/u.test(tok)) return null;
  return tok;
}

/**
 * Parse the model's free-text output into a {@link SuggestionAction}. The model is
 * asked to emit `KEYWORD: content` on one line, but small on-device models are
 * unreliable, so this is tolerant:
 *  - no recognized keyword → treat the whole output as a plain reply (the old
 *    behavior, so a model that ignores the format still works);
 *  - a keyword for an unavailable action (gated by {@link SuggestionCaps}) falls
 *    back to its content as a reply, or nothing;
 *  - returns `null` while still streaming the bare keyword, so a half-typed
 *    "REP" never flashes as a reply.
 */
export function parseSuggestionAction(raw: string, caps: SuggestionCaps): SuggestionAction | null {
  const text = raw.trim();
  if (!text) return null;

  // Still streaming the keyword itself (e.g. "REP", "THRE") — wait for content.
  const upper = text.toUpperCase();
  if (!/[:\s]/.test(text) && SUGGEST_ACTION_KEYWORDS.some((k) => k.startsWith(upper) && k !== upper)) {
    return null;
  }

  const m = /^(REPLY|REACT|THREAD|PIN)\b[:\s]*([\s\S]*)$/i.exec(text);
  if (!m) return { kind: 'reply', text }; // no tag → the whole thing is the reply
  const kw = m[1].toUpperCase();
  const content = m[2].trim();

  if (kw === 'PIN') return caps.canPin ? { kind: 'pin' } : content ? { kind: 'reply', text: content } : null;
  if (kw === 'REACT') {
    const e = firstEmoji(content);
    return e ? { kind: 'react', emoji: e } : null;
  }
  if (kw === 'THREAD') {
    if (!caps.canThread) return content ? { kind: 'reply', text: content } : null;
    return { kind: 'thread', ...(content ? { text: content } : {}) };
  }
  return content ? { kind: 'reply', text: content } : null; // REPLY
}

/** System prompt that asks the model to pick ONE next action. Only the wired
 *  actions are listed, so a thread/pin suggestion never surfaces where it can't
 *  be carried out (see {@link SuggestionCaps}). */
export function buildSuggestionSystemPrompt(caps: SuggestionCaps): string {
  const actions = [
    'REPLY: <a short, natural reply, one or two sentences> — the default, when a text response fits.',
    'REACT: <one emoji> — when an emoji reaction says it best (acknowledgement, agreement, thanks, celebration).',
  ];
  if (caps.canThread)
    actions.push(
      'THREAD: <your own short reply to post as the first message of a new thread> — when the message deserves its own focused side-conversation. Write what YOU would say in response, exactly like REPLY; do NOT repeat or copy the message you are responding to.',
    );
  if (caps.canPin)
    actions.push('PIN: — when the message is worth keeping handy (a decision, announcement, or key link); leave the content empty.');

  return (
    'You decide the user\'s single best next action in a group chat, reacting to the LAST message. ' +
    'Choose EXACTLY ONE action and output it on ONE line as the keyword, a colon, then its content:\n' +
    actions.map((a) => `- ${a}`).join('\n') +
    '\nOutput ONLY that one line — no quotes, no preamble, no explanation. ' +
    'Write any reply text in the same language as the conversation — never translate to English.'
  );
}

const SUMMARY_RULES =
  'Summarize the key topics, decisions, and open questions from these team chat messages. ' +
  'Do NOT quote messages verbatim — synthesize and compress. ' +
  "Start each room's section with a markdown heading containing only that room's exact name " +
  '(a single # then the name, for example: # general). Use at most 3 bullet points per room. ' +
  'Mention names only when relevant. Skip rooms with only trivial chatter. ' +
  'The input may include a RECENT CONTEXT block of already-read messages — use it only to ' +
  'understand what the unread messages refer to, and summarize ONLY the messages under UNREAD. ' +
  'No intro, no closing remarks, no "here is a summary" preamble. ' +
  'Write the summary in the same language as the messages — never translate to English.';

/** Summary system prompt naming the reader, so the model says "you" when the
 *  current user sent a message or is mentioned rather than using their name. */
export function buildSummarySystemPrompt(currentUserName: string): string {
  return (
    SUMMARY_RULES +
    ` The reader is "${currentUserName}" (also shown as "You" in the transcript); ` +
    'refer to them as "you" — never by name — when they sent a message or are mentioned.'
  );
}

/**
 * Map recent room messages into the LLM turn format for a reply suggestion.
 * Returns an empty array when there is not enough context to suggest anything.
 */
export function buildSuggestionMessages(
  messages: StoredMsg[],
  currentUserId: string,
): LLMMessage[] {
  // Walk newest → oldest, keeping as many non-empty messages as fit the char
  // budget, then restore chronological order. The newest message is always kept
  // even if it alone exceeds the budget, so there's always something to reply to.
  const recent: LLMMessage[] = [];
  let budget = SUGGESTION_MAX_CHARS;
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].text?.trim();
    if (!content) continue;
    if (recent.length > 0 && content.length > budget) break;
    budget -= content.length;
    recent.unshift({
      role: (messages[i].authorId === currentUserId ? 'assistant' : 'user') as 'user' | 'assistant',
      content,
    });
  }

  // Need at least one message from someone else to suggest a reply to.
  if (!recent.some((m) => m.role === 'user')) return [];
  return recent;
}

type SummaryItem = { roomName: string; author: string; text: string };

/** Group items by room name into readable `#room\nauthor: text` blocks. */
function groupByRoom(items: SummaryItem[]): string {
  const byRoom = new Map<string, string[]>();
  for (const { roomName, author, text } of items) {
    const lines = byRoom.get(roomName) ?? [];
    lines.push(`${author}: ${text}`);
    byRoom.set(roomName, lines);
  }
  const blocks: string[] = [];
  for (const [room, lines] of byRoom) {
    blocks.push(`#${room}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** Trim from the oldest end to a char budget, never starting mid-line. */
function trimOldest(content: string, max: number): string {
  if (content.length <= max) return content;
  const cut = content.slice(content.length - max);
  const nl = cut.indexOf('\n');
  return nl !== -1 ? cut.slice(nl + 1) : cut;
}

/**
 * Format unread items into a summarisation prompt. Optionally prepends a block
 * of already-read `context` messages (lead-in, not summarised) so the model can
 * resolve what the unread refers to. Each block is trimmed from the oldest end
 * to respect context limits.
 */
export function buildSummaryMessages(
  items: SummaryItem[],
  context: SummaryItem[] = [],
): LLMMessage[] {
  if (items.length === 0) return [];

  const unread = trimOldest(groupByRoom(items), SUMMARY_MAX_CHARS);

  let content = '';
  if (context.length > 0) {
    const ctx = trimOldest(groupByRoom(context), SUMMARY_CONTEXT_MAX_CHARS);
    if (ctx.trim()) {
      content += `RECENT CONTEXT (already read — for understanding only, do NOT summarize):\n${ctx}\n\n`;
    }
  }
  content += `UNREAD (summarize this):\n${unread}`;

  return [{ role: 'user', content }];
}
