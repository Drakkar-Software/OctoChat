import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import type { Room } from '@/lib/types';

/** A run of message text: plain prose, an external link (`url`), a `#channel`
 *  mention (`room` holds the name without the `#`) or an `@user` mention
 *  (`user` holds the name without the `@`). */
export interface TextSegment {
  text: string;
  /** Resolved, openable href (always absolute). Set for external links. */
  url?: string;
  /** Channel name (no leading `#`). Set for `#channel` mentions. */
  room?: string;
  /** User name (no leading `@`). Set for `@user` mentions. */
  user?: string;
}

// http(s) URLs, or bare `www.` hosts. Greedy to the next whitespace — invite
// links carry long base64url fragments (no spaces), so we want the whole run.
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
// `#channel` and `@user` mentions: the sigil + a name. Scanned only over
// non-URL text so a URL's own `#fragment` is never mistaken for a mention.
// `@user` names allow a dot so pseudos like "ada.l" round-trip.
const MENTION_RE = /([#@])([a-z0-9][a-z0-9_.-]*)/gi;
// Punctuation that commonly trails a URL in prose but isn't part of it.
const TRAILING = /[.,;:!?)\]}'"»]+$/;

/** Split a plain-text run into prose + `#channel` / `@user` mention segments. */
function splitMentions(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    const prev = start === 0 ? '' : text[start - 1];
    if (start > last) out.push({ text: text.slice(last, start) });
    // A sigil glued to the end of a word isn't a mention: "C#" (not a channel),
    // "paul@host" (an email local-part, not a user).
    if (prev && /\w/.test(prev)) {
      out.push({ text: m[0] });
      last = start + m[0].length;
      continue;
    }
    // A trailing dot is sentence punctuation ("…@michel."), not part of the name
    // — split it off so neither matching nor the highlight chip swallows it.
    // Internal dots survive (a "j.doe" pseudo / a "michel.com" handle still match).
    const trail = m[2].match(/\.+$/)?.[0] ?? '';
    const name = trail ? m[2].slice(0, -trail.length) : m[2];
    const token = trail ? m[0].slice(0, -trail.length) : m[0];
    out.push(m[1] === '#' ? { text: token, room: name } : { text: token, user: name });
    if (trail) out.push({ text: trail });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * Split a message into plain-text, external-link, `#channel`- and `@user`-mention
 * segments so the UI can render each inline and pressable. Pure: no rendering, no I/O.
 */
export function linkify(input: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of input.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    // Pull trailing punctuation back out of the link and emit it as plain text.
    const link = raw.replace(TRAILING, '');
    const dropped = raw.slice(link.length);
    if (start > last) out.push(...splitMentions(input.slice(last, start)));
    const url = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    out.push({ text: link, url });
    if (dropped) out.push({ text: dropped });
    last = start + raw.length;
  }
  if (last < input.length) out.push(...splitMentions(input.slice(last)));
  return out.length ? out : [{ text: input }];
}

/** Whether an `@mention` token names `name` (the viewer's pseudo). Tolerant of a
 *  spaced pseudo: "Ada Lovelace" still matches `@ada` or `@adalovelace`. */
export function matchesUser(token: string, name?: string): boolean {
  if (!name) return false;
  const t = token.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!t || !n) return false;
  return t === n || t === n.replace(/\s+/g, '') || t === n.split(/\s+/)[0];
}

/** Whether `text` contains an `@mention` of `name`. Pure: used to flag a stored
 *  message as @-mentioning the current viewer. */
export function mentionsUser(text: string | undefined, name?: string): boolean {
  if (!text || !name) return false;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m[1] !== '@') continue;
    const start = m.index ?? 0;
    const prev = start === 0 ? '' : text[start - 1];
    if (prev && /\w/.test(prev)) continue; // email local-part, not a mention
    if (matchesUser(m[2].replace(/\.+$/, ''), name)) return true; // drop a trailing "."
  }
  return false;
}

type Win = { open?: (url: string, target?: string, features?: string) => unknown };

/** Open an external link in a new tab on web, or the system handler on native. */
export function openUrl(url: string): void {
  if (Platform.OS === 'web') {
    (globalThis as Win).open?.(url, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(url);
}

/** Navigate to a channel from a `#mention`. */
export function openRoom(room: Room): void {
  router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });
}
