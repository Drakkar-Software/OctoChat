/**
 * Fulfils the SDK's non-streaming LLM port (`configureLlm`) by draining the app's
 * streaming on-device engine to a single string. This is the ONE place the
 * automations core reaches the native model — wired at boot in `octochat-init.ts`
 * (native only; web leaves the port unconfigured so AI automations report
 * "not available on this device").
 *
 * Room content fed here stays on-device — that's the whole point of the on-device
 * engine for an E2EE app.
 */
import { getAiSettings, type LlmGenerateOptions, type LLMMessage } from '@drakkar.software/octochat-sdk';

import { aiStream } from './ai-engine';
import { ensureModelLoaded } from './ensure-model-loaded';

/** Generate a full completion for `messages`. Loads the user's active model (or
 *  the platform built-in when none) first, then accumulates the stream. */
export async function generateText(messages: LLMMessage[], opts?: LlmGenerateOptions): Promise<string> {
  await ensureModelLoaded(getAiSettings().activeModelId);

  let accumulated = '';
  const handle = aiStream(messages, {
    ...(opts?.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
    onToken: (evt) => {
      accumulated = evt.accumulatedText;
    },
  });

  // Bridge the caller's AbortSignal to the engine's stop().
  if (opts?.signal) {
    if (opts.signal.aborted) handle.stop();
    else opts.signal.addEventListener('abort', () => handle.stop(), { once: true });
  }

  const { text } = await handle.promise;
  return text || accumulated;
}
