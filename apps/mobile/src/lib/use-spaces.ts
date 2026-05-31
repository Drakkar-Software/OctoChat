import { useMemo } from 'react';

import type { Space } from '@/lib/types';

import { useSpacesContext } from './spaces-context';
import { useUnread } from './unread-context';

/**
 * The current identity's spaces (empty until the user creates or joins one).
 *
 * Thin consumer over {@link useSpacesContext}: the registry is fetched once by the
 * provider; this hook only overlays the live per-space unread totals so the space
 * rails' Badges light up. (It can't live in the provider — that sits above the
 * unread provider to avoid a circular dependency.)
 */
export function useSpaces() {
  const { spaces, activeId, setActiveId, loading, createSpace, reorderSpaces } = useSpacesContext();
  const { unreadBySpace } = useUnread();

  const spacesWithUnread = useMemo<Space[]>(
    () => spaces.map((s) => ({ ...s, unread: unreadBySpace[s.id] ?? 0 })),
    [spaces, unreadBySpace],
  );

  return { spaces: spacesWithUnread, activeId, setActiveId, loading, createSpace, reorderSpaces };
}
