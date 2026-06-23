/**
 * Owner-side pending ticket requests for one space — a thin selector over
 * `RequestsProvider`. The provider holds ONE shared scan of the owner's inbox
 * (polled every ~60 s + on foreground + instantly on accept/decline), so both the
 * sidebar badge and the /requests screen always show the same count and list.
 *
 * The hook preserves its original interface so all existing callers are unchanged.
 */
import type { PendingRequest } from '@drakkar.software/octochat-sdk';

import { useRequests } from './requests-context';

export interface PendingRequestsHook {
  pending: PendingRequest[];
  count: number;
  loading: boolean;
  /** The reqId currently being accepted (for per-row spinners), or null. */
  acceptBusyId: string | null;
  /** The reqId currently being declined (for per-row spinners), or null. */
  declineBusyId: string | null;
  error: string | null;
  refresh: () => void;
  accept: (p: PendingRequest) => Promise<void>;
  decline: (p: PendingRequest) => Promise<void>;
}

export function usePendingRequests(spaceId: string | null): PendingRequestsHook {
  const { requestsBySpace, loading, error, acceptBusyId, declineBusyId, refresh, accept, decline } = useRequests();
  const pending = spaceId ? (requestsBySpace[spaceId] ?? []) : [];
  return { pending, count: pending.length, loading, error, acceptBusyId, declineBusyId, refresh, accept, decline };
}
