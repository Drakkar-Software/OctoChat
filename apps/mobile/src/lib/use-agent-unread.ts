/**
 * Total unread across the active space's automated ("agent") rooms — the Agents
 * bottom-tab badge count, mirroring {@link useTotalDmUnread} for the DMs tab.
 *
 * Scoped to the ACTIVE space, matching the Agents tab itself (which lists the active
 * space's `kind: 'automated'` rooms). It reuses the registry already loaded for that
 * tab, so it adds no extra read. DM-home has no automations, so it contributes zero.
 */
import { useMemo } from 'react';

import { isDmHomeId } from './dm-home';
import { useRooms } from './use-rooms';
import { useSpaces } from './use-spaces';

/** Unread total across the active space's agent rooms — the Agents tab badge count. */
export function useActiveAgentUnread(): number {
  const { activeId } = useSpaces();
  const isDmHome = isDmHomeId(activeId);
  // `useRooms` overlays the live unread count onto each room (same source the Agents
  // tab and ChannelRow badges read), so we just sum it over the automated ones.
  const { categories } = useRooms(isDmHome ? null : activeId);
  return useMemo(
    () =>
      categories.reduce(
        (n, c) => n + c.rooms.reduce((m, r) => m + (r.kind === 'automated' ? r.unread ?? 0 : 0), 0),
        0,
      ),
    [categories],
  );
}
