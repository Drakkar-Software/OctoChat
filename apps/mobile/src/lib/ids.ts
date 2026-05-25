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
