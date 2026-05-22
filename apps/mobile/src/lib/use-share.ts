/**
 * Public share-viewer state for the `/share#…` route. Decodes the credential from
 * the URL fragment, opens a Starfish client as the link's throwaway ephemeral
 * subject, reads the plaintext feed, and (for a read/write link) appends messages.
 * Needs NO session — a viewer arrives with just the link.
 */
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import {
  appendMessage,
  clientForToken,
  decodeShareToken,
  makeBroadcastMessage,
  readFeed,
  type BroadcastFeed,
  type ShareToken,
} from './starfish/broadcast';

export type ShareViewerState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; token: ShareToken; feed: BroadcastFeed };

/** The credential rides in the URL fragment, which only the web client can read. */
function currentFragment(): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  return window.location.hash ?? '';
}

export function useShareViewer() {
  const [state, setState] = useState<ShareViewerState>({ status: 'loading' });
  const [client, setClient] = useState<StarfishClient | null>(null);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const frag = currentFragment();
    if (!frag || frag === '#') {
      setState({
        status: 'error',
        error:
          Platform.OS === 'web'
            ? 'This share link is missing its credential.'
            : 'Open this share link in the OctoChat web app.',
      });
      return;
    }
    try {
      const token = decodeShareToken(frag);
      const c = clientForToken(token);
      setClient(c);
      const { feed } = await readFeed(c, token.ownerId, token.shareId);
      if (!feed) {
        setState({ status: 'error', error: 'This share no longer exists or was revoked.' });
        return;
      }
      setState({ status: 'ready', token, feed });
    } catch (e) {
      setState({ status: 'error', error: e instanceof Error ? e.message : 'Could not open this share.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Append a message to a read/write share, then refresh the feed. */
  const post = useCallback(
    async (author: string, text: string) => {
      if (state.status !== 'ready' || !client || !text.trim()) return;
      setPosting(true);
      try {
        await appendMessage(client, state.token.ownerId, state.token.shareId, makeBroadcastMessage(author, text));
        const { feed } = await readFeed(client, state.token.ownerId, state.token.shareId);
        if (feed) setState({ status: 'ready', token: state.token, feed });
      } finally {
        setPosting(false);
      }
    },
    [state, client],
  );

  return { state, post, posting, reload: load };
}
