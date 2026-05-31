import { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';
import { useSegments } from 'expo-router';

import { layout } from '@/theme';

import { useSession } from './session-context';

export interface Responsive {
  /** Current viewport width in px. */
  width: number;
  /** Current viewport height in px. */
  height: number;
  /** True once the viewport is wide enough for the desktop shell. */
  isWide: boolean;
}

/**
 * Live viewport size + a `isWide` flag driving the desktop-vs-mobile layout
 * switch. Subscribes to `Dimensions` changes so resizing a browser window
 * across {@link layout.breakpointDesktop} re-renders into the other layout.
 */
export function useResponsive(): Responsive {
  const [size, setSize] = useState(() => {
    const { width, height } = Dimensions.get('window');
    return { width, height };
  });

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setSize({ width: window.width, height: window.height });
    });
    return () => sub.remove();
  }, []);

  return { ...size, isWide: size.width >= layout.breakpointDesktop };
}

/**
 * Whether the persistent desktop shell (spaces rail + room sidebar) is active:
 * a wide viewport, a signed-in identity, and not on the onboarding stack. The
 * single source of truth shared by `AppFrame`, `StackScreen` and `AppBar` so
 * the chrome and the routed content never disagree about which layout is live.
 */
export function useInShell(): boolean {
  const { isWide } = useResponsive();
  const { session } = useSession();
  const segments = useSegments();
  return isWide && !!session && segments[0] !== '(onboarding)';
}

/** Root routes that aren't scoped to a space, so they drop the room sidebar. */
const PERSONAL_ROUTES = ['you'];

/**
 * Whether the active route is a space view that warrants the room sidebar.
 * The profile route (`/you`) is global, not scoped to a space, so it hides the
 * sidebar and lets the routed content use the full shell width. Every other
 * route (rooms, room, thread, space, members, search, threads) keeps it.
 */
export function useRoomSidebarVisible(): boolean {
  const segments = useSegments() as string[];
  return !PERSONAL_ROUTES.includes(segments[0]);
}
