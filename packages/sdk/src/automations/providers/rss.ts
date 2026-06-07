import type { AutomationProvider } from '../types';

interface RssParams {
  url: string;
}

/** Extract a tag's inner text (first match) — tolerant of CDATA. Plain regex
 *  parsing is enough for posting the latest title+link from RSS/Atom; we don't
 *  need a full XML parser. */
function pickTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m) return null;
  let v = m[1] ?? '';
  v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  // Strip HTML tags from descriptions.
  v = v.replace(/<[^>]+>/g, '').trim();
  return v || null;
}

function pickAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'i');
  const m = re.exec(xml);
  return m?.[1] ?? null;
}

/** Find the first <item>…</item> (RSS) or <entry>…</entry> (Atom). */
function firstItem(xml: string): string | null {
  const m = /<(item|entry)[^>]*>([\s\S]*?)<\/(item|entry)>/i.exec(xml);
  return m ? m[2] ?? null : null;
}

function parsePubDate(raw: string | null): number | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

/** Poll an RSS/Atom feed and post the latest item if it's new since `lastRunAt`. */
export const rssProvider: AutomationProvider<RssParams> = {
  id: 'rss',
  name: 'RSS feed',
  iconName: 'globe',
  description: 'Post new items from an RSS or Atom feed.',
  defaults: { url: '' },
  paramFields: [
    { key: 'url', label: 'Feed URL', kind: 'url', placeholder: 'https://example.com/feed.xml', required: true },
  ],
  fetch: async (params, ctx) => {
    const url = params.url?.trim();
    if (!url) return { skip: true };
    const res = await ctx.httpFetch(url);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const xml = await res.text();
    const item = firstItem(xml);
    if (!item) return { skip: true };
    const title = pickTag(item, 'title') ?? '(untitled)';
    const link = pickTag(item, 'link') ?? pickAttr(item, 'link', 'href') ?? '';
    const pub =
      parsePubDate(pickTag(item, 'pubDate')) ??
      parsePubDate(pickTag(item, 'updated')) ??
      parsePubDate(pickTag(item, 'published'));
    if (pub !== null && ctx.lastRunAt !== null && pub <= ctx.lastRunAt) return { skip: true };
    const text = link ? `${title}\n${link}` : title;
    return { text };
  },
};
