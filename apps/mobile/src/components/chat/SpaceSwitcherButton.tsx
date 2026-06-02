import { DM_HOME_ID } from '@/lib/dm-home';
import { useSpaceHeader } from '@/lib/use-space-header';

import { SpaceSwitcher } from './SpaceSwitcher';

/**
 * Context-wired {@link SpaceSwitcher}: pulls the active space + DM state from
 * {@link useSpaceHeader} so it can drop straight into a header (the native
 * nav-stack `headerLeft`, or the web {@link SpaceTabHeader}) with no prop wiring.
 */
export function SpaceSwitcherButton() {
  const { space, isDmHome, spaces, activeId, dmUnread } = useSpaceHeader();
  return (
    <SpaceSwitcher
      space={space}
      isDmHome={isDmHome}
      spaces={spaces}
      activeId={activeId ?? DM_HOME_ID}
      dmUnread={dmUnread}
    />
  );
}
