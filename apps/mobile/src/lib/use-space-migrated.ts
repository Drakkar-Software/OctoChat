import { useObjects } from './use-objects';

/** Migration diagnostic states for one space's unified object index:
 *  `loading` until the index opens, then whether the legacy `_rooms` have been
 *  seeded into it (see the TEMP MIGRATION in {@link useRooms}). */
export type MigrationState = 'loading' | 'migrated' | 'unmigrated';

/**
 * Has a space's legacy `_rooms` been seeded into the unified object index yet?
 * Opens the space's index merge-doc (read-only here) and reports whether it
 * holds any `room`/`category` nodes — the signal the migration writes. Stays
 * `loading` while the index opens (or never opens, e.g. keyring still locked),
 * so the caller renders nothing rather than a false negative.
 *
 * Diagnostic-only: one merge-doc per space row, so use sparingly (the spaces
 * switcher list, not every surface).
 */
export function useSpaceMigrated(spaceId: string, enabled = true): MigrationState {
  const { ready, nodes } = useObjects(spaceId, { enabled });
  if (!ready) return 'loading';
  return nodes.some((n) => n.type === 'room' || n.type === 'category') ? 'migrated' : 'unmigrated';
}
