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

export const SUGGESTION_SYSTEM_PROMPT =
  'You suggest a short, natural reply the user could send next in a group chat. ' +
  'Output ONLY the reply text — no quotes, no preamble, no explanation. ' +
  'Keep it to one or two sentences, casual and matching the conversation tone.';

export const SUMMARY_SYSTEM_PROMPT =
  'Summarize what the user missed in their team chat. ' +
  'Group by room. Use short markdown bullet points. ' +
  'Name who said what. Be concise — no intros or closing remarks.';

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

/**
 * Format unread items from multiple rooms into a single summarisation prompt.
 * Trims to SUMMARY_MAX_CHARS from the oldest end to respect context limits.
 */
export function buildSummaryMessages(
  items: { roomName: string; author: string; text: string }[],
): LLMMessage[] {
  if (items.length === 0) return [];

  // Group by room name for a readable block format.
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

  let content = blocks.join('\n\n');

  // Trim oldest content if over budget.
  if (content.length > SUMMARY_MAX_CHARS) {
    content = content.slice(content.length - SUMMARY_MAX_CHARS);
    // Don't start mid-line.
    const nl = content.indexOf('\n');
    if (nl !== -1) content = content.slice(nl + 1);
  }

  return [{ role: 'user', content }];
}
