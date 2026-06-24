/**
 * App-wide pending-request counter and list, shared across the sidebar badge
 * and the /requests screen. One source of truth so the count and the list never
 * diverge regardless of which surface the owner is looking at.
 *
 * Requests are NOT pushed over SSE — they arrive in the owner's inbox via
 * `scanResourceRequests` (REST-only). "Live" here means:
 *   - immediate local update on accept / decline (optimistic, no waiting for poll)
 *   - refresh on foreground (AppState → 'active')
 *   - refresh on a 60-second background interval
 * A brand-new inbound request therefore appears within the poll interval, not
 * instantly. This is the realistic limit until the server adds inbox push-events.
 *
 * Modeled after `unread-context.tsx` (ref-mirror + stable refresh callback).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, InteractionManager } from 'react-native';

import {
  listPendingTicketRequests,
  acceptNodeRequest,
  declineTicketRequest,
  type PendingRequest,
} from '@drakkar.software/octochat-sdk';

import { dispatchIndexChange } from './room-events-bus';
import { useFeature } from './use-feature';
import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';

/** Poll interval — matches the DM/ticket reconcile cadence in spaces-context. */
const POLL_INTERVAL_MS = 60_000;

interface RequestsValue {
  /** Pending requests per spaceId. Absent key = no pending requests (or not yet loaded). */
  requestsBySpace: Record<string, PendingRequest[]>;
  loading: boolean;
  error: string | null;
  /** The reqId currently being accepted (for per-row spinners), or null. */
  acceptBusyId: string | null;
  /** The reqId currently being declined (for per-row spinners), or null. */
  declineBusyId: string | null;
  /** Trigger an immediate refresh of all spaces' pending requests. */
  refresh: () => void;
  /** Accept a pending request — optimistically removes it from the local map and
   *  dispatches an index-change so the new ticket/room paints without a reload. */
  accept: (p: PendingRequest) => Promise<void>;
  /** Decline a pending request — optimistically removes it from the local map. */
  decline: (p: PendingRequest) => Promise<void>;
}

const Ctx = createContext<RequestsValue | null>(null);

export function RequestsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { spaces } = useSpacesContext();
  // Gate every effect on the `tickets` feature so the default OctoChat build
  // issues zero per-space scans on cold start. Tickets-enabled variants still
  // scan, but only after the first frame (InteractionManager below).
  const ticketsOn = useFeature('tickets');

  // Derive rail space ids. Kept in a ref so the refresh callback is stable and
  // always reads the latest list without needing it in its deps array.
  const spaceIds = useMemo(() => spaces.map((s) => s.id), [spaces]);
  const spaceIdsRef = useRef<string[]>(spaceIds);
  // Synchronous render-phase update: safe to write a ref during render; the ref
  // is always up-to-date by the time any effect or async callback reads it.
  spaceIdsRef.current = spaceIds;

  // Stable sorted-join so the polling effect only re-runs when the set changes.
  const spaceIdsKey = useMemo(() => [...spaceIds].sort().join(','), [spaceIds]);

  const [requestsBySpace, setRequestsBySpace] = useState<Record<string, PendingRequest[]>>({});
  // Ref-mirror so the stable `accept`/`decline` callbacks never read stale state.
  const mapRef = useRef<Record<string, PendingRequest[]>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null);
  const [declineBusyId, setDeclineBusyId] = useState<string | null>(null);
  // Synchronous re-entry guard: prevents two fast taps from both calling the same
  // SDK function before the first re-render disables the button (mirrors the guard
  // in the old use-pending-requests.ts).
  const inFlightRef = useRef<Set<string>>(new Set());

  // ── refresh ─────────────────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    const ids = spaceIdsRef.current;
    if (!session || ids.length === 0) return;
    setLoading(true);
    // Bounded concurrency — mirrors the 5-worker pool in conductor-init.ts so a
    // user with many spaces can't burst N concurrent per-space reads and trigger
    // 429s. JS is single-threaded so cross-worker writes to `next`/`firstError`
    // are safe across await points.
    const CONCURRENCY = 5;
    const queue = [...ids];
    const next: Record<string, PendingRequest[]> = {};
    let firstError: string | null = null;
    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift()!;
        try {
          next[id] = await listPendingTicketRequests(session, id);
        } catch (reason) {
          if (!firstError) firstError = String((reason as Error)?.message ?? reason);
        }
      }
    };
    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker),
    ).then(() => {
      // Merge: keep stale entries for any space whose fetch failed this round so
      // a transient network error doesn't wipe counts that were recently correct.
      const merged = { ...mapRef.current, ...next };
      mapRef.current = merged;
      setRequestsBySpace(merged);
      setError(firstError);
    }).finally(() => setLoading(false));
  }, [session]);

  // Clear map when the session goes away (identity switch / sign-out).
  useEffect(() => {
    if (!session) {
      const empty: Record<string, PendingRequest[]> = {};
      mapRef.current = empty;
      setRequestsBySpace(empty);
    }
  }, [session]);

  // Refresh on mount, session change, and when the space set changes.
  // Deferred behind the first frame so the rooms skeleton paints before any
  // network fan-out. When tickets is off (default OctoChat build) this is a
  // no-op — zero per-space scans on cold start.
  useEffect(() => {
    if (!ticketsOn) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      refresh();
    });
    return () => handle.cancel();
    // spaceIdsKey is a stable proxy for spaceIds — ensures we re-scan when the
    // owner joins / creates a new space while the app is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, spaceIdsKey, ticketsOn]);

  // Foreground refresh: re-scan when the app comes back to the foreground.
  useEffect(() => {
    if (!ticketsOn) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh, ticketsOn]);

  // Background poll — catches new requests that arrive while the app is open.
  useEffect(() => {
    if (!ticketsOn) return;
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, ticketsOn]);

  // ── local optimistic mutation helpers ────────────────────────────────────────

  /** Remove a single request from the map without waiting for the next poll. */
  const removeLocal = useCallback((spaceId: string, reqId: string) => {
    setRequestsBySpace((cur) => {
      const existing = cur[spaceId];
      if (!existing) return cur;
      const next = { ...cur, [spaceId]: existing.filter((p) => p.req.reqId !== reqId) };
      mapRef.current = next;
      return next;
    });
  }, []);

  // ── accept / decline ─────────────────────────────────────────────────────────

  const accept = useCallback(
    async (p: PendingRequest) => {
      if (!session) return;
      const reqId = p.req.reqId;
      if (inFlightRef.current.has(reqId)) return;
      inFlightRef.current.add(reqId);
      setAcceptBusyId(reqId);
      setError(null);
      try {
        await acceptNodeRequest(session, p);
        removeLocal(p.req.spaceId, reqId);
        // Signal the shared objindex store to repaint — the new ticket/room appears
        // immediately on this device. Other devices receive the update via SSE
        // (object.changed → dispatchIndexChange in the unread handler).
        dispatchIndexChange(p.req.spaceId);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        inFlightRef.current.delete(reqId);
        setAcceptBusyId(null);
      }
    },
    [session, removeLocal],
  );

  const decline = useCallback(
    async (p: PendingRequest) => {
      if (!session) return;
      const reqId = p.req.reqId;
      if (inFlightRef.current.has(reqId)) return;
      inFlightRef.current.add(reqId);
      setDeclineBusyId(reqId);
      setError(null);
      try {
        await declineTicketRequest(session, p);
        removeLocal(p.req.spaceId, reqId);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        inFlightRef.current.delete(reqId);
        setDeclineBusyId(null);
      }
    },
    [session, removeLocal],
  );

  const value = useMemo<RequestsValue>(
    () => ({ requestsBySpace, loading, error, acceptBusyId, declineBusyId, refresh, accept, decline }),
    [requestsBySpace, loading, error, acceptBusyId, declineBusyId, refresh, accept, decline],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRequests(): RequestsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRequests must be used within RequestsProvider');
  return v;
}

/** Pending-request count for a single space. Returns 0 when no requests are loaded
 *  yet or when the space has no pending requests. */
export function useRequestsCount(spaceId: string): number {
  const { requestsBySpace } = useRequests();
  return requestsBySpace[spaceId]?.length ?? 0;
}
