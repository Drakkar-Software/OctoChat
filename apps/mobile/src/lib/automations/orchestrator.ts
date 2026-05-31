/**
 * High-level automation operations. These compose the pure `tickRoom` core with
 * the registry write-back + secrets persistence + bot-credential mint, so the UI
 * (settings sheet, add-room flow, command watcher) calls a single function per
 * operation rather than re-orchestrating each time.
 */
import { sealToSelf, type SealedBlob } from '../starfish/account-seal';
import { isPublicSpaceId, publicSpaceAuth, createPublicRoom } from '../starfish/pubspace';
import { createStreamBotCredential } from '../starfish/stream-bots';
import type { Session } from '../starfish/identity';
import type { AutomationMeta, Room } from '../types';

import { AutomationsNotSupportedHere, deleteRoomFromRegistry, patchRoomAutomation, setRoomAutomation } from './registry-write';
import { tickRoom, type TickKind, type TickOutcome } from './runner-core';
import { clearAutomationSecrets, saveAutomationSecrets } from './secrets';
import { getProvider } from './providers';

const BOT_TTL_SEC = 365 * 24 * 3600;

/** Mint a fresh bot credential for an automated room and SEAL it to the minting
 *  account key, so the bearer token never enters the synced registry in the clear
 *  (a space reader would otherwise lift it and forge bot posts). The caller persists
 *  the sealed blob into the registry; the runner / settings sheet open it with the seed
 *  (`openStreamBotCredential`). The seal binds to the seed-derived key — it opens on the
 *  minting device or a seed-restored device, NOT a QR-paired device (which has a fresh
 *  keypair), exactly like the `pubAccess` + DM-keyring seals. */
async function mintSealedCredential(
  session: Session,
  spaceId: string,
  roomId: string,
): Promise<SealedBlob> {
  if (!isPublicSpaceId(spaceId)) throw new AutomationsNotSupportedHere();
  const { ownerId } = publicSpaceAuth(session, spaceId);
  const cred = await createStreamBotCredential(session, ownerId, spaceId, roomId, { ttlSec: BOT_TTL_SEC });
  return sealToSelf(session, JSON.stringify(cred));
}

/** Public-space-only: create a new automated room AND stamp its automation meta
 *  + bot credential + the device-local secrets. Returns the created Room. The
 *  category bucket defaults to 'AUTOMATIONS' so automated rooms group cleanly. */
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
}): Promise<Room> {
  const { session, spaceId } = opts;
  if (!isPublicSpaceId(spaceId)) throw new AutomationsNotSupportedHere();
  if (!getProvider(opts.providerId)) throw new Error(`Unknown automation provider: ${opts.providerId}`);
  // 1. Create the room as `kind: 'automated'` (storage = pubstream, same as
  //    a public stream room — the kind only changes UI + runner attach).
  const room = await createPublicRoom(session, spaceId, opts.name, opts.category ?? 'AUTOMATIONS', 'automated');
  // 2. Save secret params under the new room id.
  await saveAutomationSecrets(session.userId, room.id, opts.secrets);
  // 3. Mint the bot credential scoped to THIS room (sealed to the owner key).
  const credential = await mintSealedCredential(session, spaceId, room.id);
  // 4. Stamp the automation meta — device elects itself as the runner by default.
  const meta: AutomationMeta = {
    providerId: opts.providerId,
    params: opts.params,
    intervalMin: opts.intervalMin,
    onOpen: opts.onOpen,
    enabled: true,
    credential,
    runOnDeviceId: session.keys.edPub,
    lastRunAt: null,
    lastError: null,
  };
  await setRoomAutomation(session, spaceId, room.id, meta);
  return { ...room, automation: meta };
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

/** Rotate the bot credential — generate a new audience cap and patch the room.
 *  Doesn't revoke the old one (audience caps aren't revocable client-side); the
 *  old credential becomes orphaned and expires per its TTL. */
export async function rotateAutomatedRoomCredential(session: Session, room: Room): Promise<void> {
  const credential = await mintSealedCredential(session, room.spaceId, room.id);
  await patchRoomAutomation(session, room.spaceId, room.id, { credential });
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
