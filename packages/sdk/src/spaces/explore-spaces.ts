/**
 * Public-space directory — read side.
 *
 * The OctoChat server maintains a single list document at `_index/spaces/public`
 * via the `starfish-projection` plugin: on every write to a public space's
 * `_rooms` registry it folds that space's `{ name, ownerId, image, rooms }` into
 * the list (see apps/server/src/projections.ts). The collection is
 * `readRoles: ["public"]`, so the directory is read with NO cap — a raw,
 * unauthenticated GET, exactly like {@link readProfile} reads public profiles.
 *
 * This is a *view-only* directory: it surfaces which public spaces exist (name,
 * owner, room count) so a user can discover them. It does NOT grant access —
 * joining a public space still needs its invitation link (the index entry carries
 * no cap/key). Private spaces are deliberately absent: the projection only indexes
 * the public shard, so this never leaks invite-only spaces.
 */
import { getSyncBase, getSyncPrefix } from '../config/config';
import { fetchWithTimeout } from '../starfish/fetch-timeout';
import { spaceIndexPull } from '../starfish/paths';

/** One public space as listed in the directory. Mirrors the projection's per-entry
 *  `value` (see apps/server/src/projections.ts), plus the stable `id` (the spaceId). */
export interface PublicSpaceEntry {
  /** The public space id (`psp-…`) — the projection entry's stable key. */
  id: string;
  /** Shared display name from the public `_rooms` doc, or null if unnamed. */
  name: string | null;
  /** The owner's account userId — resolve to a pseudo with `readProfiles`. */
  ownerId: string | null;
  /** Optional shared space image (data URI), or null. */
  image: string | null;
  /** Number of channels in the space at the last `_rooms` write. */
  rooms: number;
  /** Server timestamp of the last `_rooms` write that updated this entry. */
  ts: number;
}

/** The stored shape of a projection list document: an insertion-ordered array of
 *  `{ id, value }` entries (see `ProjectionList` in @drakkar.software/starfish-projection). */
interface ProjectionListDoc {
  items?: { id?: unknown; value?: Record<string, unknown> }[];
}

/** Coerce one raw projection entry into a {@link PublicSpaceEntry}, dropping malformed rows. */
function toEntry(raw: { id?: unknown; value?: Record<string, unknown> }): PublicSpaceEntry | null {
  if (typeof raw?.id !== 'string') return null;
  const v = raw.value ?? {};
  return {
    id: raw.id,
    name: typeof v.name === 'string' ? v.name : null,
    ownerId: typeof v.ownerId === 'string' ? v.ownerId : null,
    image: typeof v.image === 'string' ? v.image : null,
    rooms: typeof v.rooms === 'number' ? v.rooms : 0,
    ts: typeof v.ts === 'number' ? v.ts : 0,
  };
}

/**
 * Read the public-space directory. Returns every listed public space, newest
 * write first. Returns `[]` (never throws) when the index is empty, missing
 * (server without the projection yet), or unreachable — the caller renders an
 * empty/offline state rather than an error wall.
 *
 * Raw unauthenticated GET like {@link readProfile}: the index is public-read, so
 * the StarfishClient (and its cap headers) is bypassed; `getSyncPrefix()` supplies the
 * `/v1/<namespace>` the client would otherwise prepend on the deployed server.
 */
export async function loadPublicSpaceIndex(): Promise<PublicSpaceEntry[]> {
  let body: { data?: ProjectionListDoc } | undefined;
  try {
    const r = await fetchWithTimeout()(`${getSyncBase()}${getSyncPrefix()}${spaceIndexPull('public')}`);
    // 404 = no public space has ever been written (index doc absent) → empty directory.
    if (!r.ok) return [];
    body = await r.json();
  } catch {
    // Offline / server unreachable — surface an empty directory, not a crash.
    return [];
  }
  const items = body?.data?.items;
  if (!Array.isArray(items)) return [];
  // Newest first so freshly-created/updated spaces surface at the top.
  return items
    .map(toEntry)
    .filter((e): e is PublicSpaceEntry => e !== null)
    .sort((a, b) => b.ts - a.ts);
}
