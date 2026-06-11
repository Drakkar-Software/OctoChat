/**
 * AI summary of unread messages across a space. Auto-fires once per space open
 * when there are unread messages; also callable on demand via run().
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  displayName,
  formatBytes,
  loadAllMessages,
  readProfiles,
} from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { useUnread } from '@/lib/unread-context';
import { useAiSettings } from '@/lib/ai-settings-context';

import { aiErrorCode, aiStream } from './ai-engine';
import { ensureModelLoaded } from './ensure-model-loaded';
import { friendlyAiError } from './ai-errors';
import { buildSummaryMessages, buildSummarySystemPrompt, SUMMARY_CONTEXT_TURNS } from '@drakkar.software/octochat-sdk';

/** Backoff between INFERENCE_BUSY re-attempts. */
const BUSY_RETRY_DELAY_MS = 500;
/** Stop patiently waiting for the engine after this window. */
const BUSY_RETRY_WINDOW_MS = 12_000;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Re-export so the card can show "≈X GB" before download.
export { formatBytes };

export type DigestStatus = 'idle' | 'loading' | 'generating' | 'ready' | 'empty' | 'error';

export interface SpaceDigest {
  status: DigestStatus;
  summary: string | null;
  error: string | null;
  unreadCount: number;
  run: () => void;
  reset: () => void;
}

export function useSpaceDigest(spaceId: string | null): SpaceDigest {
  const { settings } = useAiSettings();
  const { session } = useSession();
  const { lastReadAt, unreadBySpace } = useUnread();
  const [status, setStatus] = useState<DigestStatus>('idle');
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unreadCount = spaceId ? (unreadBySpace[spaceId] ?? 0) : 0;

  // Monotonic id of the active run(). A run() closure only writes state while
  // its captured id still matches; space-change / reset / regenerate bump it,
  // abandoning any in-flight retry loop without clobbering newer state.
  const runIdRef = useRef(0);
  // Live aiStream handle so cleanup / a new run can stop an active stream.
  const streamRef = useRef<{ stop: () => void } | null>(null);

  const run = useCallback(async () => {
    if (!session || !spaceId || !settings.enabled) return;
    if (status === 'loading' || status === 'generating') return;

    // Claim this run; stop any stream still attached to a previous run.
    const myRunId = ++runIdRef.current;
    streamRef.current?.stop();
    streamRef.current = null;
    const cancelled = () => runIdRef.current !== myRunId;

    setStatus('loading');
    setSummary(null);
    setError(null);

    try {
      const all = await loadAllMessages(session, spaceId);
      if (cancelled()) return;

      // Fetch profiles directly inside run() so names resolve correctly on the
      // first tap — usePseudos is render-bound and only populates after a render
      // cycle, which is too late for the first summary generation.
      const authorIds = [...new Set(all.map((x) => x.msg.authorId))];
      const profiles = await readProfiles(authorIds);
      if (cancelled()) return;

      const shape = ({ room, msg }: (typeof all)[number]) => ({
        roomName: room.name,
        author: displayName(msg.authorId, session.userId, profiles.get(msg.authorId)?.pseudo ?? undefined),
        text: msg.text as string,
      });

      // Filter to unread messages from other users, then shape for the prompt.
      const items = all
        .filter(
          (x) =>
            !!x.msg.text &&
            x.msg.authorId !== session.userId &&
            x.msg.ts > lastReadAt(x.room.id),
        )
        .map(shape);

      if (items.length === 0) {
        if (!cancelled()) setStatus('empty');
        return;
      }

      // Lead-in context: the most recent already-read messages (any author,
      // including the current user) so the summary can resolve what the unread
      // refers to. Sorted oldest→newest, then the last N kept.
      const context = all
        .filter((x) => !!x.msg.text && x.msg.ts <= lastReadAt(x.room.id))
        .sort((a, b) => a.msg.ts - b.msg.ts)
        .slice(-SUMMARY_CONTEXT_TURNS)
        .map(shape);

      const messages = buildSummaryMessages(items, context);
      if (messages.length === 0) {
        if (!cancelled()) setStatus('empty');
        return;
      }

      // Lazily load the downloaded model into memory on first use (deferred off
      // the post-download spike that OOM-killed the app). A load failure throws
      // and is surfaced as an error by the surrounding catch.
      await ensureModelLoaded(settings.activeModelId);
      if (cancelled()) return;

      setStatus('generating');

      // BUSY-tolerant retry loop. The on-device engine enforces a single-flight
      // guard (expo-ai-kit `inferenceInFlight`). INFERENCE_BUSY rejections leave
      // no side effects so re-calling aiStream after a backoff is a clean retry.
      // Message-building stays outside; only the stream attempt retries.
      const deadline = Date.now() + BUSY_RETRY_WINDOW_MS;
      for (;;) {
        if (cancelled()) return;
        let accumulated = '';
        const handle = aiStream(messages, {
          systemPrompt: buildSummarySystemPrompt(session.name),
          onToken: (evt) => {
            if (cancelled()) return;
            accumulated = evt.accumulatedText;
            setSummary(accumulated);
          },
        });
        streamRef.current = handle;
        try {
          await handle.promise;
          if (cancelled()) return;
          streamRef.current = null;
          setSummary(accumulated.trim() || null);
          setStatus(accumulated.trim() ? 'ready' : 'empty');
          return; // success
        } catch (e) {
          streamRef.current = null;
          if (cancelled()) return;
          const code = aiErrorCode(e);
          if (code === 'INFERENCE_BUSY' && Date.now() + BUSY_RETRY_DELAY_MS < deadline) {
            setSummary(null); // discard any partial from a torn attempt
            await delay(BUSY_RETRY_DELAY_MS);
            continue; // re-attempt; status stays 'generating' (shimmer)
          }
          throw e; // non-BUSY error, or window exhausted → real error
        }
      }
    } catch (e) {
      if (cancelled()) return;
      setError(friendlyAiError(aiErrorCode(e)));
      setStatus('error');
    }
  }, [session, spaceId, settings.enabled, settings.activeModelId, status, lastReadAt]);

  const reset = useCallback(() => {
    runIdRef.current++; // abandon any in-flight run / retry loop
    streamRef.current?.stop();
    streamRef.current = null;
    setStatus('idle');
    setSummary(null);
    setError(null);
  }, []);

  // Reset stale state when the user navigates to a different space so the
  // previous space's summary never flashes while the new one loads. Also
  // invalidates any in-flight retry loop for the old space.
  useEffect(() => {
    if (!spaceId) return;
    runIdRef.current++;
    streamRef.current?.stop();
    streamRef.current = null;
    setStatus('idle');
    setSummary(null);
    setError(null);
  }, [spaceId]);

  // Stop any streaming generation on unmount to release inferenceInFlight.
  useEffect(
    () => () => {
      runIdRef.current++;
      streamRef.current?.stop();
      streamRef.current = null;
    },
    [],
  );

  // Auto-run once per space open when there are unread messages.
  // The status guard ensures we only fire from idle (post-reset), and run()'s
  // own guard prevents concurrent calls.
  useEffect(() => {
    if (!spaceId || !settings.enabled || unreadCount === 0 || status !== 'idle') return;
    void run();
  }, [spaceId, settings.enabled, unreadCount, status, run]);

  return { status, summary, error, unreadCount, run, reset };
}
