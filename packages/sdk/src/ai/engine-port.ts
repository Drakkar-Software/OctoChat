/**
 * On-device LLM port. The text-generation engine (`expo-ai-kit`) is a NATIVE,
 * app-side module — it can't live in this platform-agnostic core (it crashes the
 * web bundle at import). So, exactly like {@link configureKv}, the host injects a
 * generation function at boot via {@link configureLlm}; SDK features (the `ai`
 * automation provider) read it through {@link runLlm}.
 *
 * The adapter is NON-streaming for simplicity — it resolves to the model's full
 * output text. The app wraps its streaming engine to fulfil this contract.
 */
import type { LLMMessage } from './llm';

export interface LlmGenerateOptions {
  /** Prepended system instruction, kept separate from the turn list so the host
   *  can map it to its engine's `systemPrompt` slot. */
  systemPrompt?: string;
  /** Abort an in-flight generation. The host stops the underlying stream. */
  signal?: AbortSignal;
}

/** A non-streaming text generator the host wires at boot. Resolves to the model's
 *  full output. */
export type LlmAdapter = (messages: LLMMessage[], opts?: LlmGenerateOptions) => Promise<string>;

let adapter: LlmAdapter | null = null;

/** Install the host's on-device generator (native only). Pass `null` to clear —
 *  e.g. on web / a device with no usable model — so features see it as absent. */
export function configureLlm(fn: LlmAdapter | null): void {
  adapter = fn;
}

/** Whether a host generator is wired. Features gate on this to degrade gracefully
 *  (post a "not available on this device" notice) rather than throw. */
export function isLlmConfigured(): boolean {
  return adapter !== null;
}

/** The configured generator, or `null` when the host never wired one. */
export function getLlm(): LlmAdapter | null {
  return adapter;
}

/** Generate against the configured engine, or throw if none is wired. */
export async function runLlm(messages: LLMMessage[], opts?: LlmGenerateOptions): Promise<string> {
  if (!adapter) throw new Error('octochat-sdk: configureLlm() not called — on-device AI is unavailable on this device.');
  return adapter(messages, opts);
}
