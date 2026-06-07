import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadAllPins, type CrossRoomMessage } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';

/**
 * Every message the space owner has pinned across the decryptable rooms of a space,
 * newest pin first. Decrypted on-device like {@link useThreads}, and re-run on screen
 * focus (via {@link useFocusEffect}) so a pin/unpin made elsewhere is reflected on
 * re-entry rather than going stale on a one-shot load.
 */
export function usePins(spaceId: string | null) {
  const { session } = useSession();
  const [pins, setPins] = useState<CrossRoomMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session || !spaceId) {
        setPins([]);
        setLoading(false);
        return;
      }
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const all = await loadAllPins(session, spaceId);
          if (!cancelled) setPins(all);
        } catch {
          if (!cancelled) setPins([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session, spaceId]),
  );

  return { pins, loading };
}
