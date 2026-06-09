/**
 * On-device reply suggestion controller. Runs INSIDE Composer (needs internal
 * text/focused/setText state, same pattern as useEmojiAutocomplete).
 *
 * Trigger: composer empty + focused + last message is from someone else.
 * Accept: fills the composer text (editable, NOT auto-sent).
 * Dismiss: clears the suggestion and won't re-show for the same message.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAiSettings } from '@/lib/ai-settings-context';

import { aiErrorCode, aiIsAvailable, aiStream } from './ai-engine';
import type { LLMMessage } from './ai-engine';
import { ensureModelLoaded } from './ensure-model-loaded';
import { SUGGESTION_SYSTEM_PROMPT } from './ai-prompt';

export interface ReplySuggestionContext {
  /** ID of the last message in the room; null when the last message is from the
   *  current user (no suggestion needed) or the room is empty. */
  lastMsgId: string | null;
  /** Closure that builds the LLM turn list from the current message snapshot. */
  buildMessages: () => LLMMessage[];
}

export type SuggestionStatus = 'idle' | 'generating' | 'ready';

export interface ReplySuggestion {
  suggestion: string | null;
  status: SuggestionStatus;
  accept: () => void;
  dismiss: () => void;
}

/** Debounce before starting generation after the trigger condition is met. */
const SUGGEST_DEBOUNCE_MS = 700;

export function useReplySuggestion(
  ctx: ReplySuggestionContext | undefined,
  composer: { text: string; focused: boolean; setText: (t: string) => void },
): ReplySuggestion {
  const { settings } = useAiSettings();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [status, setStatus] = useState<SuggestionStatus>('idle');

  // Refs to avoid stale closures in async callbacks.
  const streamRef = useRef<{ stop: () => void } | null>(null);
  const generatedForRef = useRef<string | null>(null);
  const dismissedForRef = useRef<string | null>(null);
  const platformAvailableRef = useRef<boolean | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest persisted model id, read from async generate() without re-creating it.
  const activeModelIdRef = useRef(settings.activeModelId);
  activeModelIdRef.current = settings.activeModelId;

  const clearStream = useCallback(() => {
    streamRef.current?.stop();
    streamRef.current = null;
  }, []);

  const clearSuggestion = useCallback(() => {
    clearStream();
    setSuggestion(null);
    setStatus('idle');
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [clearStream]);

  const generate = useCallback(
    async (lastMsgId: string, getMessages: () => LLMMessage[]) => {
      // Lazy availability check — cache to avoid async overhead on every keystroke.
      if (platformAvailableRef.current === null) {
        platformAvailableRef.current = await aiIsAvailable();
      }
      if (!platformAvailableRef.current) return;

      const messages = getMessages();
      if (messages.length === 0) return;

      // Lazily load the downloaded model into memory on first use. If it can't
      // load (e.g. OOM, or the file was removed), skip silently rather than
      // surfacing built-in output the user didn't ask for.
      try {
        await ensureModelLoaded(activeModelIdRef.current);
      } catch {
        return;
      }

      clearStream();
      setStatus('generating');
      setSuggestion(null);
      generatedForRef.current = lastMsgId;

      let accumulated = '';
      const handle = aiStream(messages, {
        systemPrompt: SUGGESTION_SYSTEM_PROMPT,
        onToken: (evt) => {
          accumulated = evt.accumulatedText;
          setSuggestion(accumulated);
        },
      });
      streamRef.current = handle;

      try {
        await handle.promise;
        // Strip any wrapping quotes the model sometimes adds.
        const cleaned = accumulated.replace(/^["']|["']$/g, '').trim();
        setSuggestion(cleaned || null);
        setStatus(cleaned ? 'ready' : 'idle');
      } catch (e) {
        const code = aiErrorCode(e);
        if (code !== 'INFERENCE_CANCELLED') {
          // INFERENCE_BUSY or other error — silently reset.
          setSuggestion(null);
          setStatus('idle');
        }
      } finally {
        streamRef.current = null;
      }
    },
    [clearStream],
  );

  // Clear suggestion whenever the user starts typing.
  useEffect(() => {
    if (composer.text.trim().length > 0) {
      clearSuggestion();
    }
  }, [composer.text, clearSuggestion]);

  // Main trigger effect.
  useEffect(() => {
    const { lastMsgId } = ctx ?? { lastMsgId: null };
    const shouldGenerate =
      settings.enabled &&
      ctx !== undefined &&
      lastMsgId !== null &&
      composer.text.trim().length === 0 &&
      composer.focused &&
      lastMsgId !== dismissedForRef.current &&
      lastMsgId !== generatedForRef.current;

    if (!shouldGenerate) {
      // Abort any in-flight generation if conditions no longer hold.
      if (!composer.focused || composer.text.trim().length > 0) {
        clearStream();
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        if (status === 'generating') setStatus('idle');
      }
      return;
    }

    // Clear previous suggestion for the new lastMsgId.
    setSuggestion(null);
    setStatus('idle');

    const id = lastMsgId;
    const buildMessages = ctx.buildMessages;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void generate(id, buildMessages);
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [
    settings.enabled,
    ctx,
    ctx?.lastMsgId,
    composer.text,
    composer.focused,
    status,
    generate,
    clearStream,
  ]);

  // Abort on unmount.
  useEffect(() => () => clearStream(), [clearStream]);

  const accept = useCallback(() => {
    if (suggestion) {
      composer.setText(suggestion);
    }
    clearSuggestion();
  }, [suggestion, composer, clearSuggestion]);

  const dismiss = useCallback(() => {
    dismissedForRef.current = ctx?.lastMsgId ?? null;
    clearSuggestion();
  }, [ctx?.lastMsgId, clearSuggestion]);

  if (!settings.enabled || !ctx) {
    return { suggestion: null, status: 'idle', accept: () => {}, dismiss: () => {} };
  }

  return { suggestion, status, accept, dismiss };
}
