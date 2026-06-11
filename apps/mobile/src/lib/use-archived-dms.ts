/**
 * Reactive hook for the per-identity archived-DM set. The underlying snapshot lives in
 * `archived-dms.ts` (SDK, module-global — like `mutes.ts`), so this hook requires no
 * provider: it just bridges `useSyncExternalStore` to the snapshot + wires
 * `setDmArchived` to the current session. Usable in any component below
 * {@link SessionProvider}.
 */
import { useCallback, useSyncExternalStore } from 'react';

import {
  getArchivedDms,
  isDmArchived,
  setDmArchived,
  subscribeArchivedDms,
} from '@drakkar.software/octochat-sdk';

import { useSession } from './session-context';

export interface ArchivedDmsValue {
  /** True when the given DM-space id is in the archived set. */
  isDmArchived: (spaceId: string) => boolean;
  /**
   * Archive or unarchive a DM. Optimistic + synced to the `_spaces` doc.
   * Idempotent: no-op when already in the wanted state.
   */
  setDmArchived: (spaceId: string, archived: boolean) => void;
}

export function useArchivedDms(): ArchivedDmsValue {
  const { session } = useSession();
  // Subscribe to the module-level snapshot — same pattern as useQuickReactions.
  useSyncExternalStore(subscribeArchivedDms, getArchivedDms, getArchivedDms);

  const toggle = useCallback(
    (spaceId: string, archived: boolean) => {
      if (!session) return;
      void setDmArchived(session, spaceId, archived);
    },
    [session],
  );

  return {
    isDmArchived,
    setDmArchived: toggle,
  };
}
