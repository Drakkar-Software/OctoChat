/**
 * On-demand AI summary of unread messages across a space. Mirrors use-threads.ts:
 * on-demand (called by the UI via run()), not automatic — decrypting a whole space
 * is expensive and should only run when the user explicitly asks.
 */
import { useCallback, useState } from 'react';

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
import { buildSummaryMessages, SUMMARY_SYSTEM_PROMPT } from './ai-prompt';

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

      // Filter to unread messages from other users, then shape for the prompt.
      const items = all
        .filter(
          (x) =>
            !!x.msg.text &&
            x.msg.authorId !== session.userId &&
            x.msg.ts > lastReadAt(x.room.id),
        )
        .map(({ room, msg }) => ({
          roomName: room.name,
          author: displayName(msg.authorId, session.userId, profiles.get(msg.authorId)?.pseudo ?? undefined),
          text: msg.text as string,
        }));

      if (items.length === 0) {
        setStatus('empty');
        return;
      }

      const messages = buildSummaryMessages(items);
      if (messages.length === 0) {
        setStatus('empty');
        return;
      }

      setStatus('generating');
      let accumulated = '';
      const { promise } = aiStream(messages, {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
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
  }, [session, spaceId, settings.enabled, status, lastReadAt]);

  const reset = useCallback(() => {
    setStatus('idle');
    setSummary(null);
    setError(null);
  }, []);

  return { status, summary, error, unreadCount, run, reset };
}
