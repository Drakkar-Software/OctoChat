/**
 * AI summary of unread messages across a space. Auto-fires once per space open
 * when there are unread messages; also callable on demand via run().
 */
import { useCallback, useEffect, useState } from 'react';

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
import { buildSummaryMessages, buildSummarySystemPrompt, SUMMARY_CONTEXT_TURNS } from './ai-prompt';

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

  const run = useCallback(async () => {
    if (!session || !spaceId || !settings.enabled) return;
    if (status === 'loading' || status === 'generating') return;

    setStatus('loading');
    setSummary(null);
    setError(null);

    try {
      const all = await loadAllMessages(session, spaceId);

      // Fetch profiles directly inside run() so names resolve correctly on the
      // first tap — usePseudos is render-bound and only populates after a render
      // cycle, which is too late for the first summary generation.
      const authorIds = [...new Set(all.map((x) => x.msg.authorId))];
      const profiles = await readProfiles(authorIds);

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
        setStatus('empty');
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
        setStatus('empty');
        return;
      }

      // Lazily load the downloaded model into memory on first use (deferred off
      // the post-download spike that OOM-killed the app). A load failure throws
      // and is surfaced as an error by the surrounding catch.
      await ensureModelLoaded(settings.activeModelId);

      setStatus('generating');
      let accumulated = '';
      const { promise } = aiStream(messages, {
        systemPrompt: buildSummarySystemPrompt(session.name),
        onToken: (evt) => {
          accumulated = evt.accumulatedText;
          setSummary(accumulated);
        },
      });

      await promise;
      setSummary(accumulated.trim() || null);
      setStatus(accumulated.trim() ? 'ready' : 'empty');
    } catch (e) {
      const code = aiErrorCode(e);
      setError(code ?? 'Failed to generate summary');
      setStatus('error');
    }
  }, [session, spaceId, settings.enabled, settings.activeModelId, status, lastReadAt]);

  const reset = useCallback(() => {
    setStatus('idle');
    setSummary(null);
    setError(null);
  }, []);

  // Reset stale state when the user navigates to a different space so the
  // previous space's summary never flashes while the new one loads.
  useEffect(() => {
    if (!spaceId) return;
    setStatus('idle');
    setSummary(null);
    setError(null);
  }, [spaceId]);

  // Auto-run once per space open when there are unread messages.
  // The status guard ensures we only fire from idle (post-reset), and run()'s
  // own guard prevents concurrent calls.
  useEffect(() => {
    if (!spaceId || !settings.enabled || unreadCount === 0 || status !== 'idle') return;
    void run();
  }, [spaceId, settings.enabled, unreadCount, status, run]);

  return { status, summary, error, unreadCount, run, reset };
}
