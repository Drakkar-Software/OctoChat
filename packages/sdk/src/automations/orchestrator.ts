/**
 * High-level automation operations. These compose the pure `tickRoom` core with
 * the registry write-back + secrets persistence + bot-credential mint, so the UI
 * (settings sheet, add-room flow, command watcher) calls a single function per
 * operation rather than re-orchestrating each time.
 */
import { sealToSelf } from '../starfish/account-seal';
import { type SealedBlob } from '../starfish/account-seal';
import { type StreamBotCredential } from '../starfish/stream-bots';
import { streamPubRoomPush } from '../starfish/paths';
import { getSyncBase } from '../config/config';
import { roomSlug } from '../domain/ids';
import type { Session } from '../starfish/identity';
import type { AutomationMeta, AutomationSchedule, Room } from '../domain/types';

import { createAutomationNode, deleteRoomFromRegistry, patchRoomAutomation, renameRoomInRegistry } from './registry-write';
import { tickRoom, type TickKind, type TickOutcome } from './runner-core';
import { clearAutomationSecrets, saveAutomationSecrets } from './secrets';
import { getProvider } from './providers';

const BOT_TTL_SEC = 365 * 24 * 3600;

/** Mint a fresh bot credential for an automated room and SEAL it to the minting
 *  account key, so the bearer token never enters the synced registry in the clear.
 *  The caller persists the sealed blob into the registry; the runner / settings sheet
 *  open it with the seed (`openStreamBotCredential`). */
async function mintSealedCredential(
  session: Session,
  spaceId: string,
  roomId: string,
): Promise<SealedBlob> {
  void spaceId; // per-node model: credential is room-scoped, space param unused
  const signPath = streamPubRoomPush(roomId);
  const cred: StreamBotCredential = {
    token: '',
    endpoint: `${getSyncBase()}${signPath}`,
    signPath,
    expiresAt: Math.floor(Date.now() / 1000) + BOT_TTL_SEC,
  };
  return sealToSelf(session, JSON.stringify(cred));
}

/** Create a new automated room AND stamp its automation meta + bot credential
 *  + device-local secrets. Returns the created Room. The category bucket
 *  defaults to 'AUTOMATIONS' so automated rooms group cleanly. */
export async function createAutomatedRoom(opts: {
  session: Session;
  spaceId: string;
  name: string;
  category?: string;
  providerId: string;
  params: Record<string, unknown>;
  secrets: Record<string, unknown>;
  intervalMin: number;
  onOpen: boolean;
  /** Calendar/interval cadence. When set it overrides `intervalMin` for the timing
   *  gate; `intervalMin` is still written as the legacy fallback (see AutomationMeta). */
  schedule?: AutomationSchedule;
}): Promise<Room> {
  const { session, spaceId } = opts;
  if (!getProvider(opts.providerId)) throw new Error(`Unknown automation provider: ${opts.providerId}`);
  const category = opts.category ?? 'AUTOMATIONS';
  // Mint the room id up-front (same shape `createPublicRoom`/`useRooms.createRoom` use) so
  // the secrets + bot credential bind to it BEFORE the node write — a failed mint then
  // leaves no orphan node in the index (the node create is the last, committing step).
  const roomId = `${spaceId}-${roomSlug(opts.name)}-${Date.now().toString(36)}`;
  // 1. Save secret params under the new room id (device-local kv).
  await saveAutomationSecrets(session.userId, roomId, opts.secrets);
  // 2. Mint the bot credential scoped to THIS room (sealed to the owner key).
  const credential = await mintSealedCredential(session, spaceId, roomId);
  // 3. Build the automation meta — device elects itself as the runner by default.
  const meta: AutomationMeta = {
    providerId: opts.providerId,
    params: opts.params,
    intervalMin: opts.intervalMin,
    onOpen: opts.onOpen,
    ...(opts.schedule ? { schedule: opts.schedule } : {}),
    enabled: true,
    credential,
    runOnDeviceId: session.keys.edPub,
    lastRunAt: null,
    lastError: null,
  };
  // 4. Create the room as an object-index NODE (`subtype: 'automation'`) carrying its meta —
  //    the model the room list (`objectsToRoomCategories`) + runner now read.
  await createAutomationNode(session, spaceId, roomId, opts.name, category, meta);
  return { id: roomId, spaceId, category, name: opts.name, kind: 'automated', automation: meta };
}

/** Apply an edit from the settings sheet (intervalMin / enabled / params /
 *  runOnDeviceId / cleared error) atomically through the registry funnel. */
export async function updateAutomatedRoom(opts: {
  session: Session;
  room: Room;
  patch: Partial<AutomationMeta>;
  secrets?: Record<string, unknown>;
}): Promise<void> {
  const { session, room, patch, secrets } = opts;
  if (secrets) await saveAutomationSecrets(session.userId, room.id, secrets);
  await patchRoomAutomation(session, room.spaceId, room.id, patch);
}

/** Rename an automated room — the bot's display name in the channel list and chat
 *  header. Separate from {@link updateAutomatedRoom} (which patches AutomationMeta);
 *  the name lives on the Room itself. Caller refreshes the registry to repaint. */
export async function renameAutomatedRoom(session: Session, room: Room, name: string): Promise<void> {
  await renameRoomInRegistry(session, room.spaceId, room.id, name);
}

/** Rotate the bot credential — generate a new audience cap and patch the room.
 *  Doesn't revoke the old one (audience caps aren't revocable client-side); the
 *  old credential becomes orphaned and expires per its TTL. Returns the new sealed
 *  blob so the caller can reflect it into its in-memory cache without a re-read. */
export async function rotateAutomatedRoomCredential(session: Session, room: Room): Promise<SealedBlob> {
  const credential = await mintSealedCredential(session, room.spaceId, room.id);
  await patchRoomAutomation(session, room.spaceId, room.id, { credential });
  return credential;
}

/** Delete an automated room — drops it from the registry AND clears its
 *  device-local secrets. The bot credential becomes orphaned (same as rotate). */
export async function deleteAutomatedRoom(session: Session, room: Room): Promise<void> {
  await clearAutomationSecrets(session.userId, room.id);
  await deleteRoomFromRegistry(session, room.spaceId, room.id);
}

/** The registry patch a tick outcome implies — `lastRunAt` advances (and the
 *  error clears) unless the tick failed, in which case only `lastError` is set.
 *  A scheduled post also carries `lastFetchHash` so the next tick can dedup.
 *  Shared by the server write-back AND the optimistic local cache update so the
 *  two never drift — keeping `lastFetchHash` on THIS patch is load-bearing: it's
 *  what carries the cursor into the in-memory cache, without which the next open
 *  re-hashes against a stale value and reposts (the bug `lastRunAt` had). */
export function tickStatusPatch(outcome: TickOutcome, now: number): Partial<AutomationMeta> {
  if (outcome.kind === 'failed') return { lastError: outcome.error };
  const patch: Partial<AutomationMeta> = { lastRunAt: now, lastError: null };
  if (outcome.kind === 'posted' && outcome.hash !== undefined) patch.lastFetchHash = outcome.hash;
  return patch;
}

/** Run one tick (scheduled or command) + write back lastRunAt / lastError. */
export async function runAutomationTick(opts: {
  session: Session;
  room: Room;
  trigger: TickKind;
  now: number;
  /** Bypass the content-hash dedup — set by a manual "Run now" so it always posts. */
  force?: boolean;
}): Promise<TickOutcome> {
  const provider = opts.room.automation && getProvider(opts.room.automation.providerId);
  if (!provider) return { kind: 'skipped' };
  const outcome = await tickRoom({
    session: opts.session,
    room: opts.room,
    provider,
    trigger: opts.trigger,
    now: opts.now,
    force: opts.force,
  });
  const patch = tickStatusPatch(outcome, opts.now);
  // Best-effort registry update — a failure here doesn't undo the post that
  // already happened, it just means status is stale on other devices.
  try {
    await patchRoomAutomation(opts.session, opts.room.spaceId, opts.room.id, patch);
  } catch (e) {
    console.error('[automations] failed to write tick status', e);
  }
  return outcome;
}
