/**
 * The "DM space" is a UI-only virtual space: a single rail tile that lists ALL the
 * identity's Direct Messages (across every peer) where a normal space lists its
 * channels. It is NOT a real Starfish space — it can't be joined, left, renamed or
 * invited-to. Each conversation is still its own per-peer `dm-` space under the hood
 * (see starfish/dm.ts); this just aggregates them into one navigable home.
 *
 * The id is `dms-` (NOT `dm-`) on purpose: `isDmSpaceId` (starfish/dm-ids) keys the
 * `dm-` prefix to detect a real per-peer DM space, and this sentinel must never be
 * mistaken for one.
 */
export const DM_HOME_ID = 'dms-home';
export const DM_HOME_NAME = 'Direct Messages';
/** Two-letter monogram for the rail tile fallback (the `people` icon is preferred). */
export const DM_HOME_SHORT = 'DM';

/** True when the DM space is the active selection. */
export const isDmHomeId = (id: string | null | undefined): boolean => id === DM_HOME_ID;
