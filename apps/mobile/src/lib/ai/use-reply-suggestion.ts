/**
 * On-device suggestion controller. Runs INSIDE Composer (needs internal
 * text/focused/setText state, same pattern as useEmojiAutocomplete).
 *
 * The model picks ONE next action reacting to the last message — reply, react,
 * start a thread (optionally with a starter reply), or pin — instead of always
 * offering a text reply. Action selection on a small on-device model is
 * imperfect, so parsing is tolerant and falls back to a plain reply (see
 * {@link parseSuggestionAction}).
 *
 * Trigger: composer empty + last message is from someone else (no focus required).
 * Accept: `reply` fills the composer (editable, NOT auto-sent); `react`/`pin` act
 * on the message directly; `thread` opens the thread (pre-seeded for a combo).
 * Dismiss: clears the suggestion and won't re-show for the same message.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAiSettings } from '@/lib/ai-settings-context';

import { aiErrorCode, aiStream } from './ai-engine';
import type { LLMMessage } from './ai-engine';
import { ensureModelLoaded } from './ensure-model-loaded';
import { buildSuggestionSystemPrompt, parseSuggestionAction, type SuggestionAction, type SuggestionCaps } from './ai-prompt';

export interface ReplySuggestionContext {
  /** ID of the last message in the room/thread; null when the last message is
   *  from the current user (no suggestion needed) or there are no messages. */
  lastMsgId: string | null;
  /** Closure that builds the LLM turn list from the current message snapshot. */
  buildMessages: () => LLMMessage[];
  /** Apply an emoji reaction to a message (the `react` action). */
  onReact?: (msgId: string, emoji: string) => void;
  /** Pin a message (the `pin` action) — wire only when the viewer is the owner. */
  onPin?: (msgId: string) => void;
  /** Open a thread on a message, optionally pre-seeding a starter reply (the
   *  `thread` action / "thread + answer" combo). Omit where threads can't nest
   *  (inside a thread) to keep the model from suggesting one. */
  onOpenThread?: (msgId: string, prefill?: string) => void;
}

export type SuggestionStatus = 'idle' | 'generating' | 'ready';

export interface ReplySuggestion {
  action: SuggestionAction | null;
  status: SuggestionStatus;
  accept: () => void;
  dismiss: () => void;
}

/** Debounce before starting generation after the trigger condition is met. */
const SUGGEST_DEBOUNCE_MS = 700;

const NOOP: ReplySuggestion = { action: null, status: 'idle', accept: () => {}, dismiss: () => {} };

export function useReplySuggestion(
  ctx: ReplySuggestionContext | undefined,
  composer: { text: string; focused: boolean; setText: (t: string) => void },
): ReplySuggestion {
  const { settings } = useAiSettings();
  const [action, setAction] = useState<SuggestionAction | null>(null);
  const [status, setStatus] = useState<SuggestionStatus>('idle');

  // Latest ctx held in a ref so the trigger effect can depend on the primitive
  // `lastMsgId` alone — the handler closures (onOpenThread is inline in the room
  // screen) change identity every render and must NOT re-arm generation.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const caps: SuggestionCaps = { canThread: !!ctx?.onOpenThread, canPin: !!ctx?.onPin };
  const capsRef = useRef(caps);
  capsRef.current = caps;

  // Refs to avoid stale closures in async callbacks.
  const streamRef = useRef<{ stop: () => void } | null>(null);
  const generatedForRef = useRef<string | null>(null);
  const dismissedForRef = useRef<string | null>(null);
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
    setAction(null);
    setStatus('idle');
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [clearStream]);

  const generate = useCallback(
    async (lastMsgId: string) => {
      // No `aiIsAvailable()` gate: a device without a platform built-in can still
      // run a downloaded Gemma model, so availability is decided by whether
      // `ensureModelLoaded` below succeeds rather than by the built-in check.
      const messages = ctxRef.current?.buildMessages() ?? [];
      if (messages.length === 0) return;
      const caps = capsRef.current;

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
      setAction(null);
      generatedForRef.current = lastMsgId;

      let accumulated = '';
      const handle = aiStream(messages, {
        systemPrompt: buildSuggestionSystemPrompt(caps),
        onToken: (evt) => {
          accumulated = evt.accumulatedText;
          // Parse incrementally so a streaming `reply`/`thread` text still
          // previews live; null while only the bare keyword has arrived.
          setAction(parseSuggestionAction(accumulated, caps));
        },
      });
      streamRef.current = handle;

      try {
        await handle.promise;
        const final = parseSuggestionAction(accumulated, caps);
        setAction(final);
        setStatus(final ? 'ready' : 'idle');
      } catch (e) {
        const code = aiErrorCode(e);
        if (code !== 'INFERENCE_CANCELLED') {
          // INFERENCE_BUSY or other error — silently reset.
          setAction(null);
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

  // Main trigger effect — keyed on the primitive lastMsgId (not ctx identity).
  const lastMsgId = ctx?.lastMsgId ?? null;
  useEffect(() => {
    // Suggestions generate passively — no composer.focused requirement — so the
    // chip is ready before the user taps the input. Aborted only if user types.
    const shouldGenerate =
      settings.enabled &&
      lastMsgId !== null &&
      composer.text.trim().length === 0 &&
      lastMsgId !== dismissedForRef.current &&
      lastMsgId !== generatedForRef.current;

    if (!shouldGenerate) {
      // Abort any in-flight generation only when the user starts typing.
      if (composer.text.trim().length > 0) {
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
    setAction(null);
    setStatus('idle');

    const id = lastMsgId;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void generate(id);
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [settings.enabled, lastMsgId, composer.text, status, generate, clearStream]);

  // Abort on unmount.
  useEffect(() => () => clearStream(), [clearStream]);

  const accept = useCallback(() => {
    const a = action;
    const id = ctxRef.current?.lastMsgId ?? null;
    if (a) {
      if (a.kind === 'reply') composer.setText(a.text);
      else if (id) {
        if (a.kind === 'react') ctxRef.current?.onReact?.(id, a.emoji);
        else if (a.kind === 'pin') ctxRef.current?.onPin?.(id);
        else if (a.kind === 'thread') ctxRef.current?.onOpenThread?.(id, a.text);
      }
    }
    // Mark this message handled so a non-reply action (which leaves the composer
    // empty) doesn't immediately re-generate a fresh suggestion for it.
    dismissedForRef.current = id;
    clearSuggestion();
  }, [action, composer, clearSuggestion]);

  const dismiss = useCallback(() => {
    dismissedForRef.current = ctxRef.current?.lastMsgId ?? null;
    clearSuggestion();
  }, [clearSuggestion]);

  if (!settings.enabled || !ctx) return NOOP;

  return { action, status, accept, dismiss };
}
