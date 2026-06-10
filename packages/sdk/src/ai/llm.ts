/**
 * Minimal LLM conversation types — the shape the on-device AI prompt builders
 * produce and the platform engine consumes. Kept here (not pulled from a native
 * package) so the prompt logic stays platform-agnostic and unit-testable; the
 * app's `ai-engine` adapter maps these to its native module's identical shape.
 */

export type LLMRole = 'system' | 'user' | 'assistant';

/** A single message in an LLM conversation. */
export interface LLMMessage {
  role: LLMRole;
  content: string;
}
