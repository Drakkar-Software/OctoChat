import { describe, expect, it } from 'vitest';

import { httpProvider } from './providers/http';
import { rssProvider } from './providers/rss';
import { getProvider, PROVIDERS } from './providers';
import type { RunCtx, RunResult } from './types';

const ctx = (over: Partial<RunCtx> = {}): RunCtx => ({
  lastRunAt: null,
  secretParams: {},
  httpFetch: (async () => new Response('', { status: 200 })) as typeof fetch,
  ...over,
});

describe('catalog', () => {
  it('exports rss/http by id', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['http', 'rss']);
  });
  it('getProvider returns null for unknown ids', () => {
    expect(getProvider('nope')).toBeNull();
    expect(getProvider('rss')?.id).toBe('rss');
  });
});

describe('http provider', () => {
  it('rejects an empty url with a usage hint', async () => {
    const r = (await httpProvider.onCommand!('get', [], {}, ctx())) as { text: string };
    expect(r.text).toMatch(/Usage/);
  });
  it('GETs and posts the body + status', async () => {
    const httpFetch = (async () => new Response('hi', { status: 200 })) as typeof fetch;
    const r = (await httpProvider.onCommand!('get', ['https://x.test/y'], {}, ctx({ httpFetch }))) as { text: string };
    expect(r.text).toContain('200');
    expect(r.text).toContain('hi');
  });
  it('joins a baseUrl to a bare path', async () => {
    let seen = '';
    const httpFetch = (async (input: RequestInfo | URL) => {
      seen = typeof input === 'string' ? input : input.toString();
      return new Response('ok');
    }) as typeof fetch;
    await httpProvider.onCommand!('get', ['users/1'], { baseUrl: 'https://api.example.com' }, ctx({ httpFetch }));
    expect(seen).toBe('https://api.example.com/users/1');
  });
});

describe('rss provider', () => {
  const sample = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
<title><![CDATA[Hello World]]></title>
<link>https://blog.test/hello</link>
<pubDate>Wed, 14 May 2025 12:00:00 GMT</pubDate>
</item>
</channel></rss>`;
  it('returns latest item title + link when fresh', async () => {
    const httpFetch = (async () => new Response(sample, { status: 200 })) as typeof fetch;
    const r = (await rssProvider.fetch!({ url: 'https://blog.test/feed' }, ctx({ httpFetch }))) as { text: string };
    expect(r.text).toContain('Hello World');
    expect(r.text).toContain('https://blog.test/hello');
  });
  it('skips when item is older than lastRunAt', async () => {
    const httpFetch = (async () => new Response(sample, { status: 200 })) as typeof fetch;
    const r = (await rssProvider.fetch!(
      { url: 'https://blog.test/feed' },
      ctx({ httpFetch, lastRunAt: Date.parse('Thu, 15 May 2025 00:00:00 GMT') }),
    )) as RunResult;
    expect(r).toEqual({ skip: true });
  });
  it('skips when url is empty', async () => {
    const r = (await rssProvider.fetch!({ url: '' }, ctx())) as RunResult;
    expect(r).toEqual({ skip: true });
  });
});
