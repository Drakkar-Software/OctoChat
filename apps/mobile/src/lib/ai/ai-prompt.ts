/**
 * Pure, platform-agnostic prompt builders for both on-device AI features.
 * No imports of expo-ai-kit or React — safe everywhere, unit-testable.
 */
import type { StoredMsg } from '@drakkar.software/octochat-sdk';
import type { LLMMessage } from './ai-engine';

/** How many recent messages to include as context for a reply suggestion. */
const CONTEXT_TURNS = 8;

/** Max chars of unread message text to include in a "catch me up" summary.
 *  Built-in models (Apple FM) have a small context window; Gemma 8–16k. */
export const SUMMARY_MAX_CHARS = 6000;

/** Max chars of already-read lead-in context to include alongside the unread. */
export const SUMMARY_CONTEXT_MAX_CHARS = 1500;

/** How many recent already-read messages to include as lead-in context, so the
 *  unread summary can reference what came just before it. */
export const SUMMARY_CONTEXT_TURNS = 10;

export const SUGGESTION_SYSTEM_PROMPT =
  'You suggest a short, natural reply the user could send next in a group chat. ' +
  'Output ONLY the reply text — no quotes, no preamble, no explanation. ' +
  'Keep it to one or two sentences, casual and matching the conversation tone. ' +
  'Write the reply in the same language as the conversation — never translate to English.';

const SUMMARY_RULES =
  'Summarize the key topics, decisions, and open questions from these team chat messages. ' +
  'Do NOT quote messages verbatim — synthesize and compress. ' +
  "Start each room's section with a markdown heading containing only that room's exact name " +
  '(for example: ## general). Use at most 3 bullet points per room. ' +
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
  const recent = messages
    .slice(-CONTEXT_TURNS)
    .filter((m) => m.text && m.text.trim().length > 0)
    .map((m) => ({
      role: (m.authorId === currentUserId ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.text as string,
    }));

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
