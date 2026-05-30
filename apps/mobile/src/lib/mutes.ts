/**
 * Per-identity MUTE preferences — which rooms and which whole spaces are silenced.
 *
 * Two tiers, mirroring `member-caps.ts`: the durable source of truth is the user's
 * own synced `_spaces` doc (a `mutes` key alongside `spaces`/`caps`, see
 * `registry.ts`), which a fresh device re-hydrates from its seed; the platform kv
 * (web localStorage / native AsyncStorage) is a fast, offline cache that also feeds
 * the headless background-push task (no provider tree runs there). Kept as a
 * module-level snapshot — like `notification-settings.ts` — so the notification code
 * paths (`notify.ts`, the SSE room-change callback, `usePush`) can read it
 * synchronously, while React consumers subscribe via `MutesProvider`.
 *
 * A mute value is `true` (muted forever) or an epoch-ms number (muted until then) —
 * `isMuteActive` reads both, but the current UI only writes `true` / deletes the key.
 * The timed form is here so a value written by a future build behaves with no
 * migration.
 *
 * Effects (gated downstream): a muted SPACE drops its FCM topic subscription (no
 * native push at all) and suppresses web/desktop toasts for every room in it; a muted
 * ROOM suppresses its toast + the Android decrypted-content upgrade. Unread badges
 * are KEPT in both cases (silence-only) — see `unread-context`.
 */
import type { MutePrefs, MuteValue } from '@/lib/types';

import type { Session } from './starfish/identity';
import { updateMutesDoc } from './starfish/registry';
import { kvGet, kvSet } from './starfish/kv';

const EMPTY: MutePrefs = { rooms: {}, spaces: {} };
const keyFor = (userId: string) => `octochat.mutes.${userId}`;

let cache: MutePrefs = EMPTY;
let activeKey: string | null = null;
// Count of local mute writes whose server round-trip is still in flight. While > 0, a
// navigation/foreground re-hydrate (SpacesProvider.refresh) must NOT replace the cache:
// the server may not yet reflect the just-made optimistic change, so a wholesale replace
// would visibly revert it. Reads don't need this (their merge is monotonic).
let pending = 0;
const listeners = new Set<() => void>();

/** A mute is active when set to `true` (forever) or to a future epoch-ms instant. */
export function isMuteActive(v: MuteValue | undefined): boolean {
  return v === true || (typeof v === 'number' && v > Date.now());
}

function coerce(raw: unknown): MutePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown; spaces?: unknown };
  const pick = (v: unknown): Record<string, MuteValue> =>
    v && typeof v === 'object' ? (v as Record<string, MuteValue>) : {};
  return { rooms: pick(r.rooms), spaces: pick(r.spaces) };
}

function mapEqual(a: Record<string, MuteValue>, b: Record<string, MuteValue>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}
function prefsEqual(a: MutePrefs, b: MutePrefs): boolean {
  return mapEqual(a.rooms, b.rooms) && mapEqual(a.spaces, b.spaces);
}

// ── Synchronous reads (for the non-React notification code paths) ───────────────
export function getMutePrefs(): MutePrefs {
  return cache;
}
export function isRoomMuted(roomId: string): boolean {
  return isMuteActive(cache.rooms[roomId]);
}
export function isSpaceMuted(spaceId: string): boolean {
  return isMuteActive(cache.spaces[spaceId]);
}
/** True when the room itself is muted OR its whole space is. `spaceId` defaults to
 *  the room's space (derivable from the id), so callers with a `RoomChange` can pass
 *  the event's spaceId to skip the derive. */
export function isMuted(roomId: string, spaceId: string): boolean {
  return isRoomMuted(roomId) || isSpaceMuted(spaceId);
}

/** Subscribe to snapshot changes (drives `useSyncExternalStore`). */
export function subscribeMutes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: MutePrefs): void {
  cache = next;
  for (const l of listeners) l();
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

/**
 * Load the active account's mute prefs into memory. Call (and await) on sign-in and
 * on every account switch. `serverPrefs` comes from the SAME `_spaces` read that
 * hydrates caps (session-context), so the doc isn't pulled twice. It is
 * SERVER-AUTHORITATIVE and replaces the cache wholesale — that is what lets an unmute
 * on another device (a deleted key) propagate here, rather than being re-added from
 * stale local state. The kv copy is warmed for the headless background task and for
 * the next offline open. (An unreachable read degrades to empty upstream and so
 * transiently clears the cache; a later successful sync — the server copy is never
 * overwritten with empty — re-heals it.)
 */
export async function hydrateMutes(userId: string, serverPrefs: MutePrefs): Promise<void> {
  activeKey = keyFor(userId);
  // A local mute write is still settling — don't let this re-hydrate clobber the
  // optimistic value with a server copy that hasn't caught up yet (it would revert the
  // toggle until the next navigation). The write's own emit already reflects the change.
  if (pending > 0) return;
  // Skip the emit/persist when the synced prefs match what we already hold — this now
  // runs on every navigation/foreground re-pull (SpacesProvider.refresh), and a new
  // snapshot reference would re-render every consumer for an unchanged value.
  if (prefsEqual(cache, serverPrefs)) return;
  emit(serverPrefs);
  await kvSet(activeKey, JSON.stringify(serverPrefs));
}

/** Drop the in-memory prefs on account switch / sign-out; leaves disk untouched so
 *  the next {@link hydrateMutes} reloads the new user's set. Twin of
 *  `clearMemberCaps` — wired into `resetAccountScopedState`. */
export function resetMutes(): void {
  activeKey = null;
  emit(EMPTY);
}

/** KV-only read for the headless background-push task (no provider tree, no server
 *  round-trip): returns the last-synced prefs warmed to disk by {@link hydrateMutes}. */
export async function loadMutesFromKv(userId: string): Promise<MutePrefs> {
  const raw = await kvGet(keyFor(userId));
  if (!raw) return EMPTY;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
}

/** Apply an explicit mute target to one sub-map (`rooms` or `spaces`), returning the
 *  next prefs or `null` if nothing changed (so the synced write can no-op). Muting
 *  sets `true`; unmuting deletes the key. */
function applyMute(prefs: MutePrefs, field: 'rooms' | 'spaces', id: string, muted: boolean): MutePrefs | null {
  const already = isMuteActive(prefs[field][id]);
  if (muted === already && !(muted === false && id in prefs[field])) return null;
  const sub = { ...prefs[field] };
  if (muted) sub[id] = true;
  else delete sub[id];
  return { ...prefs, [field]: sub };
}

async function setMute(session: Session, field: 'rooms' | 'spaces', id: string, muted: boolean): Promise<void> {
  activeKey = keyFor(session.userId);
  // Optimistic local update (notify React + warm kv) so the UI flips instantly.
  const next = applyMute(cache, field, id, muted);
  if (next) {
    emit(next);
    persist();
  }
  // Sync to the durable doc, applying the SAME explicit target to fresh server state
  // (idempotent — survives a concurrent edit on another device, last-writer-wins).
  // `pending` brackets the round-trip so a navigation re-hydrate can't revert the
  // optimistic emit above before the server reflects it.
  pending++;
  try {
    await updateMutesDoc(session.accountClient, session.userId, (cur) => applyMute(cur, field, id, muted));
  } catch (err) {
    console.error('[OctoChat] mutes: failed to sync mute change', err);
  } finally {
    pending--;
  }
}

export const setRoomMute = (session: Session, roomId: string, muted: boolean): Promise<void> =>
  setMute(session, 'rooms', roomId, muted);
export const setSpaceMute = (session: Session, spaceId: string, muted: boolean): Promise<void> =>
  setMute(session, 'spaces', spaceId, muted);
