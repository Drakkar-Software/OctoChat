/**
 * Identifier helpers — one source for unguessable ids.
 *
 * `randomId()` is a CSPRNG-backed 128-bit id (16 random bytes, hex). Use it for
 * EVERY storage/space/room/message/blob id: `Math.random()` is not a CSPRNG, and
 * for ids that double as storage-path leaves or seal AAD a predictable/collidable
 * id is a security weakness (a guessable space id undermines the server's
 * first-writer-owns trust-on-first-use; a collidable blob id allows a same-path
 * overwrite). `crypto.getRandomValues` is available on web and on native
 * (react-native-quick-crypto installs `global.crypto`); it's the same primitive
 * `pairing.ts` already relies on. Hex output is path-safe.
 */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Slug for the human part of a room id (`<spaceId>-<slug>-<ts>`). A room id is
 * BOTH a URL path segment (`/room/[id]`) AND a server storage-path leaf, and the
 * server's FilesystemObjectStore rejects any key outside `[a-zA-Z0-9._:@/-]`
 * (and any `..` segment) with "Invalid storage key". So a raw name like `Q&A`,
 * `C++`, `café` or `日本語` — only lower-cased + whitespace-collapsed before —
 * produced an id the server refused, leaving a room that showed in the registry
 * but 400'd on every message push. Restrict to URL-clean `[a-z0-9-]`: lower-case,
 * map every other run to a single `-`, trim edge hyphens, cap length (the id is
 * already `sp-`+32hex+`-`…+`-`+ts, so keep the slug bounded), and fall back to
 * `room` when a name strips to nothing. The room's DISPLAY name is stored raw
 * elsewhere — only the id leaf is slugged.
 */
export function roomSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room'
  );
}
