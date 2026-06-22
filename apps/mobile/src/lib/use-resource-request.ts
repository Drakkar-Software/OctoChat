/**
 * Hook for the requester-facing side of the resource-request flow (shared rooms + tickets).
 *
 * Wraps `submitRoomRequest` / `submitTicketRequest` / `claimGrantedNodes` /
 * `claimRejectedRequests` / `getOutgoingRequestsForSpace` from the SDK and tracks
 * submission state, pending reqIds (in-memory; acceptResourceGrant and addJoinedSpace are
 * idempotent so re-processing on restart is safe), newly-claimed grants, and refusals
 * (persisted across restarts via `extra.outgoingRequests`).
 *
 * All business logic lives here; `app/request.tsx` only reads route params and calls these.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  claimGrantedNodes,
  claimRejectedRequests,
  getOutgoingRequestsForSpace,
  submitRoomRequest,
  submitTicketRequest,
  type ResourceGrant,
  type ResourceReject,
  type SubmitRoomRequestOpts,
  type SubmitTicketRequestOpts,
} from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { useSpacesContext } from '@/lib/spaces-context';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RequestNodeType = 'room' | 'ticket';

export interface SubmitRequestOpts {
  type: RequestNodeType;
  requestLink: string;
  title: string;
  requester: string;
  message?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface UseResourceRequestReturn {
  /** Call to file a new room or ticket request. Resolves to an error string or null. */
  submit: (opts: SubmitRequestOpts) => Promise<string | null>;
  /** Whether a submit or claim is in progress. */
  busy: boolean;
  /** Grants claimed in the current session (owner accepted; rooms ready to open). */
  claimed: ResourceGrant[];
  /** The refusal that matched this session's submitted reqId (or a persisted past refusal
   *  for this space), or null when the request is pending / accepted. */
  refused: ResourceReject | null;
  /** Reset the refused state + submitted flag so the form reappears for a fresh submit. */
  reset: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Manages the full requester lifecycle: submit a request, poll/claim the grant-back,
 * and detect refusals (both live and persisted across restarts).
 *
 * @param spaceId The space the request link targets. Used to load persisted outgoing-request
 *   status on mount so a prior refusal is surfaced after app restart.
 */
export function useResourceRequest(spaceId?: string): UseResourceRequestReturn {
  const { session } = useSession();
  const { refresh } = useSpacesContext();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<ResourceGrant[]>([]);
  const [refused, setRefused] = useState<ResourceReject | null>(null);
  const seenReqIds = useRef<Set<string>>(new Set());
  // Track the reqId filed in the current session so we only surface a refusal for OUR request.
  const pendingReqId = useRef<string | null>(null);

  const claimPending = useCallback(async (): Promise<ResourceGrant[]> => {
    if (!session) return [];
    try {
      const grants = await claimGrantedNodes(session, { seenReqIds: seenReqIds.current });
      if (grants.length > 0) {
        grants.forEach((g) => seenReqIds.current.add(g.reqId));
        setClaimed((prev) => [...prev, ...grants]);
        // Refresh the spaces list so the new guest room appears in the SSE subscription
        // and in the GuestRoomSection without requiring a navigation round-trip.
        void refresh();
      }
      // Also check for refusals so the live-wait case flips immediately.
      const rejects = await claimRejectedRequests(session, { seenReqIds: seenReqIds.current });
      for (const r of rejects) {
        seenReqIds.current.add(r.reqId);
        // Only surface the refusal if it matches the request we filed this session.
        if (pendingReqId.current === r.reqId) {
          setRefused(r);
        }
      }
      return grants;
    } catch {
      return [];
    }
  }, [session, refresh]);

  // On mount: auto-claim grants from a previous session, and restore a persisted refusal.
  useEffect(() => {
    if (!session) return;
    void claimPending();
    // Restore persisted refusal across restarts: if the most recent outgoing request for
    // this space is refused, surface it immediately so the screen shows the declined state.
    if (spaceId) {
      void getOutgoingRequestsForSpace(session, spaceId).then((requests) => {
        const latest = requests[0]; // newest-first; fresh re-submit will supersede a refused one
        if (latest?.status === 'refused') {
          setRefused({ v: 1, kind: 'reject', reqId: latest.reqId });
        }
      });
    }
  }, [session, spaceId, claimPending]);

  const reset = useCallback(() => {
    setRefused(null);
    pendingReqId.current = null;
  }, []);

  const submit = useCallback(async (submitOpts: SubmitRequestOpts): Promise<string | null> => {
    if (!session) return 'Sign in first.';
    // Use a ref guard instead of state to avoid recreating this callback on every busy toggle.
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      let reqId: string | undefined;
      if (submitOpts.type === 'room') {
        const roomOpts: SubmitRoomRequestOpts = {
          title: submitOpts.title,
          requester: submitOpts.requester,
          message: submitOpts.message,
        };
        ({ reqId } = await submitRoomRequest(session, submitOpts.requestLink, roomOpts));
      } else {
        const ticketOpts: SubmitTicketRequestOpts = {
          title: submitOpts.title,
          requester: submitOpts.requester,
          message: submitOpts.message,
          priority: submitOpts.priority,
        };
        ({ reqId } = await submitTicketRequest(session, submitOpts.requestLink, ticketOpts));
      }
      // Track the reqId so claimPending can match a refusal back to this session's request.
      pendingReqId.current = reqId;
      // Poll for the grant-back immediately; keep busy=true until claim completes so the
      // submit button stays disabled during the round-trip. Race against a timeout so a
      // hung scanResourceGrants (post-submit network drop) doesn't freeze the button.
      await Promise.race([
        claimPending(),
        new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
      ]);
      return null;
    } catch (e) {
      return String((e as Error)?.message ?? e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [session, claimPending]);

  return { submit, busy, claimed, refused, reset };
}
