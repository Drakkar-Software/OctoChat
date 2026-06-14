/**
 * Public-space directory — read side.
 *
 * The OctoChat server maintains ONE public list document via the
 * `starfish-projection` plugin (see apps/server/src/projections.ts):
 *
 *   `_index/spaces/public` — spaces with at least one public room, carrying:
 *       `{ publicRooms, ts }` (from `objindex` writes) union-merged with
 *       `{ name, image }` (from `spaceregistry` writes).
 *
 * The `spaceindex` collection is `readRoles: ["public"]`, so it is read with
 * NO cap — unauthenticated GET. Entries without `publicRooms > 0` are ignored
 * by the client (private-space names may transiently appear in the raw list doc
 * from a `spaceregistry` write, but they are filtered out before display).
 */
import { getSyncBase, getSyncPrefix } from '../config/config';
import { fetchWithTimeout } from '../starfish/fetch-timeout';
import { spaceIndexPull } from '../starfish/paths';
import type { Session } from '../starfish/identity';

/** One public space as listed in the directory. */
export interface PublicSpaceEntry {
  /** The space id (`sp-…`). */
  id: string;
  /** Number of public rooms at the last `objindex` write. */
  publicRooms: number;
  /** Display name from `_access`, or null before the batch resolves. */
  name: string | null;
  /** Optional space image (data URI) from `_access`, or null. */
  image: string | null;
  /** Server timestamp of the last `objindex` write that updated this entry. */
  ts: number;
}

/** The stored shape of a projection list document. */
interface ProjectionListDoc {
  items?: { id?: unknown; value?: Record<string, unknown> }[];
}

/**
 * Coerce one raw projection entry from `_index/spaces/public`.
 *
 * Returns null (and is filtered out) when:
 *   - `id` is not a string (malformed entry).
 *   - `publicRooms` is absent or zero — this covers private-space name/image
 *     entries that land in the public shard from a `spaceregistry` write before
 *     the matching `objindex` removal fires. Filtering here ensures they never
 *     appear in the Explore screen.
 */
function toPublicEntry(raw: { id?: unknown; value?: Record<string, unknown> }): PublicSpaceEntry | null {
  if (typeof raw?.id !== 'string') return null;
  const v = raw.value ?? {};
  const publicRooms = typeof v.publicRooms === 'number' ? v.publicRooms : 0;
  // Require at least one live public room — drop name-only entries (private spaces).
  if (publicRooms === 0) return null;
  return {
    id: raw.id,
    publicRooms,
    ts: typeof v.ts === 'number' ? v.ts : 0,
    name: typeof v.name === 'string' ? v.name : null,
    image: typeof v.image === 'string' ? v.image : null,
  };
}

async function fetchIndex(shard: 'public' | 'meta'): Promise<{ data?: ProjectionListDoc } | undefined> {
  try {
    const r = await fetchWithTimeout()(`${getSyncBase()}${getSyncPrefix()}${spaceIndexPull(shard)}`);
    if (!r.ok) return undefined;
    return await r.json() as { data?: ProjectionListDoc };
  } catch {
    return undefined;
  }
}

/**
 * Read the public-space directory from `_index/spaces/public`. Each entry
 * carries `{ publicRooms, ts, name, image }` (populated by the two server-side
 * projections that both target the same shard). Entries with `publicRooms === 0`
 * are filtered out — they are private-space name remnants, not discoverable spaces.
 * Returns every discoverable space (≥ 1 public room), newest write first.
 * Returns `[]` on any error (offline, empty directory, etc.).
 */
export async function loadPublicSpaceIndex(): Promise<PublicSpaceEntry[]> {
  const publicBody = await fetchIndex('public');
  const publicItems = publicBody?.data?.items;
  if (!Array.isArray(publicItems)) return [];
  return publicItems
    .map(toPublicEntry)
    .filter((e): e is PublicSpaceEntry => e !== null)
    .sort((a, b) => b.ts - a.ts);
}

/**
 * No-op kept for API compatibility — names are now resolved inside
 * {@link loadPublicSpaceIndex} from the `_index/spaces/public` shard directly.
 * Callers can remove this call; it returns the list unchanged.
 */
export async function resolveSpaceNames(
  spaces: PublicSpaceEntry[],
  _session: Session,
): Promise<PublicSpaceEntry[]> {
  return spaces;
}
