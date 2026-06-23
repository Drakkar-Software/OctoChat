/**
 * Owner-side pending ticket requests for one space (manual-mode "Incoming requests"). Lists the
 * sealed requests waiting in the owner's inbox and lets the owner Accept (→ create the ticket) or
 * Decline each. Accepting nudges the space's object index to re-pull so the new ticket appears in
 * the Tickets shelf without a reload.
 *
 * Only relevant for a space the user owns, on a desk-capable build — callers gate rendering on
 * `useFeature('tickets')`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

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
  // Synchronous re-entry guard: React state updates are async so two fast taps can both
  // pass the state check before the first re-render disables the button. A ref Set is
  // checked synchronously and blocks the second call in the same JS tick. Mirrors the
  // busyRef pattern in use-resource-request.ts.
  const inFlightRef = useRef<Set<string>>(new Set());

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
      // Synchronous guard: block a second tap that arrives before the first re-render
      // disables the button. Without this, two fast taps both pass the state check and
      // both call acceptNodeRequest → two ticket nodes created for one request.
      if (inFlightRef.current.has(p.req.reqId)) return;
      inFlightRef.current.add(p.req.reqId);
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
        inFlightRef.current.delete(p.req.reqId);
        setAcceptBusyId(null);
      }
    },
    [session, spaceId, removeLocal],
  );

  const decline = useCallback(
    async (p: PendingRequest) => {
      if (!session || !spaceId) return;
      if (inFlightRef.current.has(p.req.reqId)) return;
      inFlightRef.current.add(p.req.reqId);
      setDeclineBusyId(p.req.reqId);
      setError(null);
      try {
        await declineTicketRequest(session, p);
        removeLocal(p.req.reqId);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        inFlightRef.current.delete(p.req.reqId);
        setDeclineBusyId(null);
      }
    },
    [session, spaceId, removeLocal],
  );

  return { pending, count: pending.length, loading, acceptBusyId, declineBusyId, error, refresh, accept, decline };
}
