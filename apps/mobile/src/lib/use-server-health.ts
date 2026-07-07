import { useCallback, useEffect, useRef, useState } from 'react';

import { SYNC_BASE, SYNC_NAMESPACE } from './octochat-config';

// Reachability probe URL. Local dev (no namespace): the apps/server mounts the
// sync router at root and always exposes `/health`, with permissive CORS. The
// deployed drakkar-sync, however, fronts Starfish with an nginx that ONLY routes
// the specific `/sync/v1/<ns>/{push,pull,list,events,batch/pull,config}` subpaths;
// every other path (including the backend's real `/v1/<ns>/health`) falls through
// to nginx's catch-all `return 404`, and the bare host `/health` carries no CORS
// headers. So on the deployed multi-tenant host we probe `/v1/<ns>/config` — our
// own namespace's collection manifest, nginx-routed and CORS-enabled — instead of
// the unrelated shared `/v1/config` (which lists a different product's namespace,
// not ours). A 200 confirms our own sync namespace is reachable.
const HEALTH_URL = SYNC_NAMESPACE ? `${SYNC_BASE}/v1/${SYNC_NAMESPACE}/config` : `${SYNC_BASE}/health`;
const POLL_MS = 30_000;
const TIMEOUT_MS = 4_000;

export type HealthStatus = 'checking' | 'ok' | 'down';

export interface ServerHealth {
  status: HealthStatus;
  /** Round-trip latency of the last successful probe, in ms. */
  latencyMs: number | null;
  /** Wall-clock time (ms) of the last probe attempt. */
  checkedAt: number | null;
  /** Force an immediate re-probe. */
  recheck: () => void;
}

/**
 * Probes a Starfish reachability endpoint (see {@link HEALTH_URL}) and returns the
 * current reachability.
 *
 * Used by the settings DIAGNOSTICS card. Re-runs every 30 s while mounted; the
 * card also exposes a manual refresh through `recheck`. Aborts in-flight probes
 * on unmount and on each re-probe so a stuck request doesn't pin the spinner.
 */
export function useServerHealth(): ServerHealth {
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const probe = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setStatus('checking');
    const t0 = Date.now();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(HEALTH_URL, { signal: ctrl.signal, cache: 'no-store' });
      const dt = Date.now() - t0;
      if (ctrl.signal.aborted) return;
      setCheckedAt(Date.now());
      if (r.ok) {
        setStatus('ok');
        setLatencyMs(dt);
      } else {
        setStatus('down');
        setLatencyMs(null);
      }
    } catch {
      if (ctrl.signal.aborted && inflight.current !== ctrl) return;
      setCheckedAt(Date.now());
      setStatus('down');
      setLatencyMs(null);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void probe();
    const id = setInterval(() => void probe(), POLL_MS);
    return () => {
      clearInterval(id);
      inflight.current?.abort();
    };
  }, [probe]);

  return { status, latencyMs, checkedAt, recheck: () => void probe() };
}
