/**
 * Pure splitter that turns a streamed "catch me up" summary into per-room
 * sections so the card can render its own single-`#` channel header and make the
 * WHOLE section tappable (not just the heading text).
 *
 * Tolerant by design: the on-device model is told to head each room's section
 * with a markdown heading, but small models are unreliable — they emit `#` or
 * `##`, sometimes with no blank line before the bullets, sometimes echoing the
 * `#general` channel form INTO the heading. We accept all of those rather than
 * depend on the SDK markdown parser's stricter single-line-heading rule (which is
 * exactly why a literal "##" sometimes leaked through into the rendered card).
 */

export interface DigestSection {
  /** Room name, stripped of any leading `#`/whitespace — feeds both the resolver
   *  (for clickability) and the rendered `#name` header. Empty for a pre-heading
   *  preamble block (rendered as plain body, no header). */
  room: string;
  /** Markdown body under the heading (bullets, prose). May be empty while the
   *  model is still streaming the section. */
  body: string;
}

// A heading line: up to 3 leading spaces, 1–6 `#`, optional space, then the name.
// `\s*` (not `\s+`) tolerates `##general` with no space. A `#` the model echoed
// into the name (e.g. `## #general`) is stripped from the captured name below.
const HEADING_RE = /^\s{0,3}#{1,6}\s*(.+?)\s*$/;

/** Split a (possibly partial) summary into ordered per-room sections. */
export function splitDigestSections(summary: string): DigestSection[] {
  const lines = summary.replace(/\r\n/g, '\n').split('\n');
  const sections: DigestSection[] = [];
  let cur: DigestSection | null = null;

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      const room = m[1].replace(/^#+\s*/, '').trim();
      cur = { room, body: '' };
      sections.push(cur);
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line;
    } else if (line.trim()) {
      // Stray prose before any heading — keep it visible as a header-less block.
      cur = { room: '', body: line };
      sections.push(cur);
    }
  }

  return sections.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.room || s.body);
}
