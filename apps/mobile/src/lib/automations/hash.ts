/**
 * Content cursor for scheduled fetches. A provider's `fetch` returns the text it
 * wants to post; the runner hashes it and, when the hash matches the last posted
 * one (`AutomationMeta.lastFetchHash`), skips the post. This stops a feed/endpoint
 * that keeps returning the same content from reposting it every interval — uniform
 * across every fetch provider, so a new one can't forget to dedup.
 */

/** Stable 32-bit FNV-1a hash of a string, hex. Not cryptographic — only used to
 *  tell "same content as last time" from "changed". */
export function hashContent(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Decide whether a freshly fetched `text` is new vs the last posted hash. Pure so
 *  the runner's dedup gate is unit-testable without the network/post side-effects. */
export function dedupeFetch(text: string, prevHash: string | null | undefined): { post: boolean; hash: string } {
  const hash = hashContent(text);
  return { post: hash !== (prevHash ?? null), hash };
}
