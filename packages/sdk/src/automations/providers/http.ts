import type { AutomationProvider } from '../types';

interface HttpParams {
  /** Optional base URL — when present, /get/post args may omit the host. */
  baseUrl?: string;
  /** Optional URL polled on the schedule. Empty → no scheduled run (commands only). */
  pollUrl?: string;
  /** Scheduled HTTP method — 'GET' (default) or 'POST'. */
  pollMethod?: string;
  /** Request body sent when the scheduled method is POST. */
  pollBody?: string;
}

/** Resolve a bare path against the optional base URL; absolute URLs pass through. */
function resolveUrl(raw: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = (baseUrl ?? '').replace(/\/+$/, '');
  if (!base) return raw;
  return `${base}/${raw.replace(/^\/+/, '')}`;
}

/** Cap a response body so a chat post stays readable. */
function cap(s: string): string {
  return s.length > 1000 ? `${s.slice(0, 1000)}…` : s;
}

/** Universal escape hatch: drive HTTPS endpoints from the room — by command or on
 *  a schedule.
 *  `/get <url>` — GET, posts the response body (truncated).
 *  `/post <url> <body>` — POST with Content-Type: application/json, posts the response.
 *  Scheduled: set a Poll URL (+ method/body) to GET or POST it each interval — the
 *  runner only reposts when the response changes. */
export const httpProvider: AutomationProvider<HttpParams> = {
  id: 'http',
  name: 'HTTP',
  iconName: 'globe',
  description: 'Call HTTPS endpoints from the room with /get and /post, or poll a URL on a schedule.',
  defaults: { pollMethod: 'GET' },
  paramFields: [
    { key: 'baseUrl', label: 'Base URL (optional)', kind: 'url', placeholder: 'https://api.example.com' },
    { key: 'pollUrl', label: 'Scheduled poll URL (optional)', kind: 'url', placeholder: 'https://api.example.com/status' },
    { key: 'pollMethod', label: 'Scheduled method (GET or POST)', kind: 'text', placeholder: 'GET' },
    { key: 'pollBody', label: 'POST body (JSON, scheduled POST only)', kind: 'textarea', placeholder: '{ }' },
  ],
  commands: [
    { name: 'get', usage: '/get <url>', description: 'GET the URL and post the response.' },
    { name: 'post', usage: '/post <url> <json>', description: 'POST the JSON body to the URL.' },
  ],
  fetch: async (params, ctx) => {
    const url = (params.pollUrl ?? '').trim();
    if (!url) return { skip: true };
    const method = String(params.pollMethod ?? 'GET').trim().toUpperCase() === 'POST' ? 'POST' : 'GET';
    const init =
      method === 'POST'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: String(params.pollBody ?? '') }
        : undefined;
    const res = await ctx.httpFetch(resolveUrl(url, params.baseUrl), init);
    const body = await res.text();
    // Non-2xx → treated as a failure so `lastError` records the status + body
    // (matching RSS's behaviour). The error string rides into the room log line
    // and the status UI instead of being silently posted as a success message.
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}\n${cap(body)}`);
    return { text: `${method} ${url} → ${res.status}\n${cap(body)}` };
  },
  onCommand: async (cmd, args, params, ctx) => {
    if (cmd === 'get') {
      const url = args[0];
      if (!url) return { text: 'Usage: /get <url>' };
      try {
        const res = await ctx.httpFetch(resolveUrl(url, params.baseUrl));
        const body = await res.text();
        return { text: `GET ${url} → ${res.status}\n${cap(body)}` };
      } catch (e) {
        return { text: `GET ${url} failed: ${String((e as Error)?.message ?? e)}` };
      }
    }
    if (cmd === 'post') {
      const url = args[0];
      const body = args.slice(1).join(' ');
      if (!url) return { text: 'Usage: /post <url> <json>' };
      try {
        const res = await ctx.httpFetch(resolveUrl(url, params.baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const text = await res.text();
        return { text: `POST ${url} → ${res.status}\n${cap(text)}` };
      } catch (e) {
        return { text: `POST ${url} failed: ${String((e as Error)?.message ?? e)}` };
      }
    }
    return { skip: true };
  },
};
