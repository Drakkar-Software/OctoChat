/**
 * Per-identity DM HEAD TIMESTAMPS — the server-assigned `ts` of the most-recent
 * message in each DM conversation, used as the authoritative sort key for the DM list
 * (`useDms` in the app). Without this, the DM list sorts by a device-local SSE-derived
 * "latest activity" cache: each device accumulates a different observation history →
 * divergent sort order → web and mobile disagree.
 *
 * The server-assigned `ts` lives on the PLAINTEXT outer envelope of each `streamchat`
 * append element (inside the sealed `data` is the message body; `ts` is outside). A
 * `last:1` pull therefore returns the head without any decryption — same pattern as the
 * notification-preview bounded tail pull.
 *
 * `refreshDmHeads` folds three sources (cheapest first) via MAX-merge so the sort
 * order is as fresh as possible immediately, then self-corrects once the network
 * round-trips complete:
 *
 *  1. kv — prior persisted heads (instant, offline-safe warm start)
 *  2. local streamlog cache — `octochat.streamlog.v2.<userId>.<roomId>` (no network, no decrypt;
 *     covers DMs opened on this device, same authoritative server `ts`)
 *  3. server `last:1` pull — one small request per DM (no decrypt, pull-cache-backed);
 *     the ONLY source that makes a never-opened DM sort correctly and two devices agree
 *
 * The network step is throttled (~15 s) and concurrent calls coalesce so navigation
 * spam doesn't fan out N pulls each time.
 */
import type { AppendElement } from '@drakkar.software/starfish-client';

import { kvGet, kvSet } from '../config/adapters';
import { dmRoomId } from '../starfish/dm-ids';
import { getSpaceClient } from '@drakkar.software/octospaces-sdk';
import { streamRoomPull } from '../starfish/paths';
import { loadStreamLog } from './stream-log';
import type { Session } from '../starfish/identity';

// ── Module state ────────────────────────────────────────────────────────────────

/** Per-room last-message server ts (room id → epoch-ms). Max-merged, never rolled back. */
let heads: Record<string, number> = {};
const listeners = new Set<() => void>();
let activeKey: string | null = null;

/** Timestamp of the last successful network refresh (for throttling). */
let lastRefreshAt = 0;
/** Coalesce concurrent refresh calls onto a single in-flight promise. */
let inflight: Promise<void> | null = null;

/** How long to suppress a repeat network refresh (sources 1+2 still run). */
const THROTTLE_MS = 15_000;

// ── Internal helpers ─────────────────────────────────────────────────────────────

function emit(next: Record<string, number>): void {
  heads = next;
  for (const l of listeners) l();
}

/** Max-merge `incoming` into `base`. Returns the SAME reference when nothing advanced
 *  so callers can detect a no-op by identity. */
function maxMerge(
  base: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  let changed = false;
  const next = { ...base };
  for (const [roomId, ts] of Object.entries(incoming)) {
    if (Number.isFinite(ts) && ts > (next[roomId] ?? 0)) {
      next[roomId] = ts;
      changed = true;
    }
  }
  return changed ? next : base;
}

function kv(userId: string): string {
  return `octochat.dmhead.${userId}`;
}

async function persist(): Promise<void> {
  if (activeKey) await kvSet(activeKey, JSON.stringify(heads)).catch(() => {});
}

// ── Public reads (for useSyncExternalStore) ──────────────────────────────────────

/** The current head-timestamp map — synchronous read. */
export function getDmHeads(): Record<string, number> {
  return heads;
}

/** Subscribe to head-map changes (drives `useSyncExternalStore`). */
export function subscribeDmHeads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────────

/**
 * Warm the store from the persisted kv snapshot for this identity. Called once at
 * session open (before `refreshDmHeads`) so an offline cold start sorts by the last
 * known authoritative order, not alphabetically.
 */
export async function loadDmHeadsFromKv(userId: string): Promise<void> {
  activeKey = kv(userId);
  const raw = await kvGet(activeKey).catch(() => null);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const merged = maxMerge(heads, parsed);
    if (merged !== heads) emit(merged);
  } catch {
    // corrupt kv — ignore, next refresh will re-seed
  }
}

/** Clear the head-ts map on sign-out so a fresh session never inherits the prior one's. */
export function resetDmHeads(): void {
  heads = {};
  activeKey = null;
  lastRefreshAt = 0;
  inflight = null;
  emit(heads);
}

// ── Main refresher ───────────────────────────────────────────────────────────────

/**
 * Refresh the DM head-timestamp map. Folds three sources in order and max-merges the
 * result into the store. Called from `SpacesProvider.refresh()` (mount, navigation,
 * app foreground) — the internal throttle absorbs nav spam.
 *
 * @param session  The active session (for building space-scoped sync clients).
 * @param dmSpaceIds  All DM space ids for the identity (from the `dms` map values).
 * @param opts.force  Skip the throttle and force a fresh network pass.
 */
export function refreshDmHeads(
  session: Session,
  dmSpaceIds: string[],
  opts?: { force?: boolean },
): Promise<void> {
  if (inflight) return inflight;
  inflight = _refresh(session, dmSpaceIds, opts?.force ?? false).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function _refresh(
  session: Session,
  dmSpaceIds: string[],
  force: boolean,
): Promise<void> {
  if (dmSpaceIds.length === 0) return;

  // ── Source 2: local streamlog cache ─────────────────────────────────────────
  // Read the cached ciphertext envelopes for each DM room opened on this device.
  // `item.ts` is the server-assigned outer timestamp — plaintext, no decrypt needed.
  const localHeads: Record<string, number> = {};
  await Promise.allSettled(
    dmSpaceIds.map(async (spaceId) => {
      const roomId = dmRoomId(spaceId);
      const items = await loadStreamLog(session.userId, roomId);
      if (items.length > 0) {
        localHeads[roomId] = Math.max(...items.map((i: AppendElement) => i.ts ?? 0));
      }
    }),
  );
  let merged = maxMerge(heads, localHeads);

  // Emit immediately after the free local step so opened DMs sort correctly
  // before the network round-trips below complete.
  if (merged !== heads) {
    emit(merged);
    await persist();
  }

  // ── Source 3: authoritative server head (last:1 pull) ────────────────────────
  // Skip when throttled (unless force) — kv + local are still fresh enough.
  const now = Date.now();
  if (!force && now - lastRefreshAt < THROTTLE_MS) return;
  lastRefreshAt = now;

  const serverHeads: Record<string, number> = {};
  await Promise.allSettled(
    dmSpaceIds.map(async (spaceId) => {
      try {
        // Use the space client to get the auth'd client (no keyring needed —
        // we only read the outer `ts`, not the sealed body).
        const client = getSpaceClient(spaceId, session);
        const items = (await client.pull(streamRoomPull(dmRoomId(spaceId)), {
          appendField: 'items',
          last: 1,
        })) as unknown as AppendElement[];
        const ts = items?.[0]?.ts;
        if (ts && Number.isFinite(ts)) {
          serverHeads[dmRoomId(spaceId)] = ts;
        }
      } catch {
        // No cap / offline / server error — fall back to kv + local value. The pull
        // cache in the SDK client already serves a stale snapshot on network failure.
      }
    }),
  );

  merged = maxMerge(heads, serverHeads);
  if (merged !== heads) {
    emit(merged);
    await persist();
  }
}
