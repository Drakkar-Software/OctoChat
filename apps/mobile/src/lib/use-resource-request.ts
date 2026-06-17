/**
 * Hook for the requester-facing side of the resource-request flow (shared rooms + tickets).
 *
 * Wraps `submitRoomRequest` / `submitTicketRequest` / `claimGrantedNodes` from the SDK
 * and tracks submission state, pending reqIds (persisted to KV so the claim poll survives
 * an app restart), and newly-claimed grants.
 *
 * All business logic lives here; `app/request.tsx` only reads route params and calls these.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  claimGrantedNodes,
  submitRoomRequest,
  submitTicketRequest,
  type ResourceGrant,
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
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Manages the full requester lifecycle: submit a request, then poll/claim the grant-back. */
export function useResourceRequest(): UseResourceRequestReturn {
  const { session } = useSession();
  const { refresh } = useSpacesContext();
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<ResourceGrant[]>([]);
  const seenReqIds = useRef<Set<string>>(new Set());

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
      return grants;
    } catch {
      return [];
    }
  }, [session, refresh]);

  // Auto-claim on mount (catches grants from a previous session).
  useEffect(() => {
    if (!session) return;
    void claimPending();
  }, [session, claimPending]);

  const submit = useCallback(async (submitOpts: SubmitRequestOpts): Promise<string | null> => {
    if (!session) return 'Sign in first.';
    if (busy) return null;
    setBusy(true);
    try {
      if (submitOpts.type === 'room') {
        const roomOpts: SubmitRoomRequestOpts = {
          title: submitOpts.title,
          requester: submitOpts.requester,
          message: submitOpts.message,
        };
        await submitRoomRequest(session, submitOpts.requestLink, roomOpts);
      } else {
        const ticketOpts: SubmitTicketRequestOpts = {
          title: submitOpts.title,
          requester: submitOpts.requester,
          message: submitOpts.message,
          priority: submitOpts.priority,
        };
        await submitTicketRequest(session, submitOpts.requestLink, ticketOpts);
      }
      // Start polling for the grant-back immediately after submitting.
      void claimPending();
      return null;
    } catch (e) {
      return String((e as Error)?.message ?? e);
    } finally {
      setBusy(false);
    }
  }, [session, busy, claimPending]);

  return { submit, busy, claimed };
}
