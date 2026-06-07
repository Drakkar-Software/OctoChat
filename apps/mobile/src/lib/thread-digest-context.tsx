/**
 * Holds the recent-threads digest of the room the viewer currently has open, so
 * the persistent desktop sidebar ({@link DesktopRoomSidebar}) can list a room's
 * latest threads under its row without reaching into that room screen's store.
 *
 * Only ONE room is open at a time, so the provider holds a single digest. The open
 * room screen publishes it via {@link ThreadDigestPublisher}; the sidebar reads it
 * and renders it only under the row whose id matches `digest.roomId`. There is no
 * cross-room data here — closed rooms aren't synced (see `use-room.ts`), so they
 * have no thread digest until opened.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { ThreadSummary } from '@drakkar.software/octochat-sdk';

interface ActiveThreadDigest {
  roomId: string;
  threads: ThreadSummary[];
}

interface ThreadDigestValue {
  /** Recent threads of the open room, or null when no room is open. */
  digest: ActiveThreadDigest | null;
  /**
   * Publish the open room's threads, or clear them by passing `threads: null`.
   * The clear is owner-guarded: it only nulls the digest when the caller still
   * owns it (`roomId` matches), so a screen unmounting *after* its successor has
   * already published can't wipe the newer digest.
   */
  publish: (roomId: string, threads: ThreadSummary[] | null) => void;
}

const Ctx = createContext<ThreadDigestValue | null>(null);

export function ThreadDigestProvider({ children }: { children: ReactNode }) {
  const [digest, setDigest] = useState<ActiveThreadDigest | null>(null);

  const publish = useCallback((roomId: string, threads: ThreadSummary[] | null) => {
    setDigest((prev) => {
      if (threads === null) return prev && prev.roomId === roomId ? null : prev;
      return { roomId, threads };
    });
  }, []);

  const value = useMemo<ThreadDigestValue>(() => ({ digest, publish }), [digest, publish]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThreadDigest(): ThreadDigestValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useThreadDigest must be used within ThreadDigestProvider');
  return v;
}
