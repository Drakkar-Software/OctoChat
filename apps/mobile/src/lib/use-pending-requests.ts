/**
 * Owner-side pending ticket requests for one space (manual-mode "Incoming requests"). Lists the
 * sealed requests waiting in the owner's inbox and lets the owner Accept (→ create the ticket) or
 * Decline each. Accepting nudges the space's object index to re-pull so the new ticket appears in
 * the Tickets shelf without a reload.
 *
 * Only relevant for a space the user owns, on a desk-capable build — callers gate rendering on
 * `useFeature('tickets')`.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  listPendingTicketRequests,
  acceptNodeRequest,
  declineTicketRequest,
  type PendingRequest,
} from '@drakkar.software/octochat-sdk';

import { dispatchIndexChange } from './room-events-bus';
import { useSession } from './session-context';

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
  const { session } = useSession();
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null);
  const [declineBusyId, setDeclineBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!session || !spaceId) {
      setPending([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void listPendingTicketRequests(session, spaceId)
      .then((items) => {
        setPending(items);
        setError(null);
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [session, spaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Drop the resolved request from the local list (setPending is stable, so no dep needed).
  const removeLocal = useCallback(
    (reqId: string) => setPending((cur) => cur.filter((p) => p.req.reqId !== reqId)),
    [],
  );

  const accept = useCallback(
    async (p: PendingRequest) => {
      if (!session || !spaceId) return;
      setAcceptBusyId(p.req.reqId);
      setError(null);
      try {
        await acceptNodeRequest(session, p);
        removeLocal(p.req.reqId);
        // Pull the shared objindex store once — the new ticket/room paints immediately
        // on this device without a reload. Other devices get the update via SSE
        // (object.changed event → dispatchIndexChange in the unread handler).
        dispatchIndexChange(spaceId);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setAcceptBusyId(null);
      }
    },
    [session, spaceId, removeLocal],
  );

  const decline = useCallback(
    async (p: PendingRequest) => {
      if (!session || !spaceId) return;
      setDeclineBusyId(p.req.reqId);
      setError(null);
      try {
        await declineTicketRequest(session, p);
        removeLocal(p.req.reqId);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setDeclineBusyId(null);
      }
    },
    [session, spaceId, removeLocal],
  );

  return { pending, count: pending.length, loading, acceptBusyId, declineBusyId, error, refresh, accept, decline };
}
