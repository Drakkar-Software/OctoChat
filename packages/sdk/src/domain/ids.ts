/**
 * Identifier helpers — re-exported from @drakkar.software/octospaces-sdk.
 *
 * `randomId()` is a CSPRNG-backed 128-bit id (16 random bytes, hex). Use it for
 * EVERY storage/space/room/message/blob id: `Math.random()` is not a CSPRNG, and
 * for ids that double as storage-path leaves or seal AAD a predictable/collidable
 * id is a security weakness. `crypto.getRandomValues` is available on web and on
 * native (react-native-quick-crypto installs `global.crypto`). Hex output is path-safe.
 *
 * `roomSlug(name)` restricts a display name to URL-clean `[a-z0-9-]` so it is safe
 * as both a URL path segment and a server storage-path leaf. Falls back to `'room'`.
 */
export { randomId, roomSlug } from '@drakkar.software/octospaces-sdk';
