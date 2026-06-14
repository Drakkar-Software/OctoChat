/**
 * Per-identity ARCHIVED DMs — the set of DM-space ids the user has hidden from the
 * DM list. Synced via the `_spaces` doc (an `archivedDms` key alongside `mutes`,
 * `reads`, `quickReactions`, etc.) so an archive on one device propagates cross-device.
 *
 * A new incoming message for an archived DM **auto-resurfaces** it: the SSE callback
 * in `unread-context` calls `setDmArchived(session, spaceId, false)` so the DM pops
 * back to the top of the list with its unread badge.
 *
 * This is a rare boolean toggle (like a mute), not a high-frequency monotonic mark
 * (like a read), so:
 * - No debounce — each toggle writes immediately.
 * - No kv tier — there is no headless background consumer that needs a synchronous
 *   offline read (unlike mutes, which feed the push task). An offline cold-start shows
 *   the default (unarchived) until the next successful `_spaces` pull heals it, which
 *   is acceptable.
 * - `pending` guard — same as `mutes.ts`: brackets the server round-trip so a
 *   navigation/foreground re-hydrate can't revert an optimistic toggle.
 *
 * Keyed by DM-space id (`dm-…`) — a set-as-map (values are `true`) mirroring how
 * `mutes.spaces` stores `spaceId → true`.
 */
import type { ArchivedDms } from '../domain/types';
import type { Session } from '../starfish/identity';
import { updateArchivedDmsDoc } from '../starfish/registry';

const EMPTY: ArchivedDms = {};

let snapshot: ArchivedDms = EMPTY;
// Count of in-flight server round-trips for archive toggles. While > 0, a
// navigation/foreground re-hydrate must NOT replace the snapshot — the server may not
// yet reflect the optimistic change, so a wholesale replace would visibly revert it.
// Twin of the `pending` guard in `mutes.ts`.
let pending = 0;
const listeners = new Set<() => void>();

// ── Synchronous reads (called from the non-React SSE closure in unread-context) ──

/** The current archived-DM set — synchronous read for any non-React caller. */
export function getArchivedDms(): ArchivedDms {
  return snapshot;
}

/** True when the given DM-space id is in the archived set. */
export function isDmArchived(spaceId: string): boolean {
  return snapshot[spaceId] === true;
}

/** Subscribe to snapshot changes (drives `useSyncExternalStore`). */
export function subscribeArchivedDms(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────────

function setSnapshot(next: ArchivedDms): void {
  snapshot = next;
  for (const l of listeners) l();
}

function setsEqual(a: ArchivedDms, b: ArchivedDms): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (b[k] !== true) return false;
  return true;
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Load the active account's archived-DM set into the snapshot. `serverSet` comes from
 * the SAME `_spaces` read that hydrates caps/mutes/reads (session-context), so the doc
 * isn't pulled twice. SERVER-AUTHORITATIVE wholesale replace: what lets an archive (or
 * unarchive) on another device propagate here. Skipped while a local write is in-flight
 * (the `pending` guard) and when the value is already equal (avoids a no-op re-render).
 */
export function hydrateArchivedDms(serverSet: ArchivedDms): void {
  if (pending > 0) return;
  if (setsEqual(snapshot, serverSet)) return;
  setSnapshot(serverSet);
}

/** Clear the archived-DM set on sign-out so a fresh session never inherits the prior
 *  one's. Wired into `resetAccountScopedState`. Twin of `resetMutes`. */
export function resetArchivedDms(): void {
  setSnapshot(EMPTY);
}

/**
 * Archive or unarchive a DM. Optimistically updates the snapshot (so the list
 * reorders/filters instantly) then syncs to the durable `_spaces` doc. Idempotent:
 * no server write when the wanted state already matches the CURRENT snapshot (avoids
 * a write on every SSE resurface tick when the DM is already unarchived).
 *
 * `pending` brackets the round-trip so a navigation re-hydrate can't revert the
 * optimistic emit before the server reflects it — twin of `setMute`.
 */
export async function setDmArchived(session: Session, spaceId: string, archived: boolean): Promise<void> {
  // Optimistic local update.
  const already = isDmArchived(spaceId);
  if (archived === already) return; // idempotent — already in the wanted state
  const next: ArchivedDms = { ...snapshot };
  if (archived) {
    next[spaceId] = true;
  } else {
    delete next[spaceId];
  }
  setSnapshot(next);
  // Sync to the durable `_spaces` doc.
  pending++;
  try {
    await updateArchivedDmsDoc(session.spacesRegistryClient, session.userId, (cur) => {
      const curArchived = cur[spaceId] === true;
      if (archived === curArchived) return null; // server already matches — no-op
      const n: ArchivedDms = { ...cur };
      if (archived) {
        n[spaceId] = true;
      } else {
        delete n[spaceId];
      }
      return n;
    });
  } catch (err) {
    console.error('[OctoChat] archived-dms: failed to sync archive change', err);
  } finally {
    pending--;
  }
}
