import type { AutomationProvider } from '../types';

interface HttpParams {
  /** Optional base URL — when present, /get/post args may omit the host. */
  baseUrl?: string;
}

/** Universal escape hatch: drive HTTPS endpoints from the room.
 *  `/get <url>` — GET, posts the response body (truncated).
 *  `/post <url> <body>` — POST with Content-Type: application/json, posts the response. */
export const httpProvider: AutomationProvider<HttpParams> = {
  id: 'http',
  name: 'HTTP',
  iconName: 'globe',
  description: 'Make HTTPS calls from the room with /get and /post.',
  defaults: {},
  paramFields: [
    { key: 'baseUrl', label: 'Base URL (optional)', kind: 'url', placeholder: 'https://api.example.com' },
  ],
  commands: [
    { name: 'get', usage: '/get <url>', description: 'GET the URL and post the response.' },
    { name: 'post', usage: '/post <url> <json>', description: 'POST the JSON body to the URL.' },
  ],
  onCommand: async (cmd, args, params, ctx) => {
    const join = (raw: string): string => {
      if (/^https?:\/\//i.test(raw)) return raw;
      const base = (params.baseUrl ?? '').replace(/\/+$/, '');
      if (!base) return raw;
      return `${base}/${raw.replace(/^\/+/, '')}`;
    };
    const cap = (s: string) => (s.length > 1000 ? `${s.slice(0, 1000)}…` : s);
    if (cmd === 'get') {
      const url = args[0];
      if (!url) return { text: 'Usage: /get <url>' };
      try {
        const res = await ctx.httpFetch(join(url));
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
        const res = await ctx.httpFetch(join(url), {
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
