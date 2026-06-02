import { isDmHomeId } from '@/lib/dm-home';
import { useProfile } from '@/lib/profile-context';
import { useSpaces } from '@/lib/use-spaces';
import { useTotalDmUnread } from '@/lib/use-dms';
import type { Space } from '@/lib/types';

export interface SpaceHeaderData {
  /** Active space — `undefined` when the virtual DM home is selected. */
  space?: Space;
  isDmHome: boolean;
  spaces: Space[];
  activeId: string | null;
  /** Aggregate DM unread (badged on DM home / feeds the switcher dot). */
  dmUnread: number;
  /** Signed-in identity avatar + two-letter monogram for the profile control. */
  avatar?: string | null;
  meLabel: string;
}

/**
 * The data behind the mobile space header — active space, DM state and the
 * signed-in identity — pulled from the shared contexts. Shared by the web
 * {@link SpaceTabHeader} and the native nav-stack header so both surface the
 * same identity from one place.
 */
export function useSpaceHeader(): SpaceHeaderData {
  const { spaces, activeId } = useSpaces();
  const { profile } = useProfile();
  const dmUnread = useTotalDmUnread();
  const isDmHome = isDmHomeId(activeId);
  const space = isDmHome ? undefined : spaces.find((s) => s.id === activeId) ?? spaces[0];
  const meLabel = (profile?.name ?? '··').slice(0, 2).toUpperCase();
  return { space, isDmHome, spaces, activeId, dmUnread, avatar: profile?.avatar, meLabel };
}
