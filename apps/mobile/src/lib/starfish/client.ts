/**
 * Starfish client construction + room keyring/encryptor helpers
 * (ported from the satellite chat example, adapted to OctoChat).
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishCapProvider } from '@drakkar.software/starfish-client';
import { createKeyring, createKeyringEncryptor } from '@drakkar.software/starfish-keyring';
import type { Keyring } from '@drakkar.software/starfish-keyring';

import { SYNC_BASE } from './config';
import { keyringPull, keyringPush, membersPush, roomPull, roomPush } from './paths';

export interface DeviceKeys {
  edPriv: string;
  edPub: string;
  kemPriv: string;
  kemPub: string;
}

export function capProviderFor(cap: unknown, devEdPrivHex: string): StarfishCapProvider {
  return {
    async getCap() {
      return { cap: cap as never, devEdPrivHex };
    },
  };
}

export function makeClient(cap: unknown, devEdPrivHex: string): StarfishClient {
  return new StarfishClient({ baseUrl: SYNC_BASE, capProvider: capProviderFor(cap, devEdPrivHex) });
}

/**
 * Open a room's decryptor, throwing a descriptive error per failure mode
 * (unreachable server / no keyring yet / not a recipient) instead of collapsing
 * them all to null.
 *
 * `trustedAdders` is the fail-closed provenance pin the SDK requires (the
 * keyring's per-entry `addedSig` is self-attesting, so a hostile server could
 * substitute a wrapped CEK). Pass the Ed25519 pubkey(s) of whoever may grant
 * keyring access: the room owner — `keys.edPub` for our own rooms, the member
 * cap's `iss` for a joined room.
 */
export async function openEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  roomId: string,
  trustedAdders: string[],
): Promise<Encryptor> {
  const res = await client.pull(keyringPull(roomId)).catch(() => {
    throw new Error('Could not reach the server to fetch room keys.');
  });
  const keyring = res?.data as unknown as Keyring | undefined;
  if (!keyring || !keyring.epochs) {
    throw new Error('This room has no keyring yet — ask the owner to open it first.');
  }
  try {
    const enc = await createKeyringEncryptor(
      keyring,
      { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv },
      { trustedAdders },
    );
    return enc as unknown as Encryptor;
  } catch {
    throw new Error("You're not a recipient of this room's keyring yet — ask the owner to re-invite.");
  }
}

/** Soft variant of {@link openEncryptor}: returns null instead of throwing,
 *  for cross-room sweeps where an unreadable room is simply skipped. */
export async function buildEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  roomId: string,
  trustedAdders: string[],
): Promise<Encryptor | null> {
  try {
    return await openEncryptor(client, keys, roomId, trustedAdders);
  } catch {
    return null;
  }
}

/** Owner-side: create the room keyring if missing, return an encryptor. */
export async function ownerEnsureKeyring(
  client: StarfishClient,
  keys: DeviceKeys,
  roomId: string,
): Promise<Encryptor> {
  const krRes = await client.pull(keyringPull(roomId)).catch(() => null);
  let keyring = krRes?.data as unknown as Keyring | undefined;
  if (!keyring || !keyring.epochs) {
    const created = await createKeyring({ edPrivHex: keys.edPriv, edPubHex: keys.edPub }, [
      { subKemHex: keys.kemPub },
    ]);
    keyring = created.keyring;
    await client.push(keyringPush(roomId), keyring as unknown as Record<string, unknown>, krRes?.hash ?? null);
  }
  const enc = await createKeyringEncryptor(
    keyring,
    { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv },
    { trustedAdders: [keys.edPub] },
  );
  return enc as unknown as Encryptor;
}

/** Owner-side: seed an empty encrypted room document if missing. */
export async function ensureRoomInitialized(
  client: StarfishClient,
  encryptor: Encryptor,
  roomId: string,
): Promise<void> {
  const res = await client.pull(roomPull(roomId)).catch(() => null);
  if (res?.data && (res.data as Record<string, unknown>)._encrypted) return;
  const sealed = await encryptor.encrypt({ messages: [], reactions: [] });
  await client.push(roomPush(roomId), sealed as Record<string, unknown>, res?.hash ?? null);
}

/** Pre-seed an empty member directory (server returns 200 {} for missing docs). */
export async function ensureMembersInitialized(client: StarfishClient, roomId: string): Promise<void> {
  const res = await client.pull(`/pull/chatmembers/rooms/${roomId}/_members`).catch(() => null);
  if (res?.data && Array.isArray((res.data as Record<string, unknown>).entries)) return;
  await client.push(membersPush(roomId), { v: 1, entries: [] }, res?.hash ?? null);
}

/**
 * Re-seal a room's document at the keyring's current epoch so a recipient added
 * after a revoke (wrapped only into the current epoch) can still read history.
 * Best-effort — never throws. Call right after adding a recipient.
 */
export async function reSealRoomAtCurrentEpoch(
  client: StarfishClient,
  keys: DeviceKeys,
  roomId: string,
): Promise<void> {
  try {
    const ownerEnc = await buildEncryptor(client, keys, roomId, [keys.edPub]);
    const res = await client.pull(roomPull(roomId)).catch(() => null);
    const data = res?.data as Record<string, unknown> | undefined;
    if (ownerEnc && data && data._encrypted) {
      const sealed = await ownerEnc.encrypt(await ownerEnc.decrypt(data));
      await client.push(roomPush(roomId), sealed as Record<string, unknown>, res?.hash ?? null);
    }
  } catch {
    /* best-effort re-key hygiene */
  }
}

/** Read any user's public profile pseudo. */
export async function readPseudo(userId: string): Promise<string | null> {
  try {
    const r = await fetch(`${SYNC_BASE}/pull/user/${userId}/profile`);
    if (!r.ok) return null;
    const body = await r.json();
    const pseudo = body?.data?.pseudo;
    return typeof pseudo === 'string' ? pseudo : null;
  } catch {
    return null;
  }
}

/** Write the caller's own profile pseudo (needs a cap with write on `profile`). */
export async function writePseudo(client: StarfishClient, userId: string, pseudo: string): Promise<void> {
  const current = await client.pull(`/pull/user/${userId}/profile`).catch(() => null);
  await client.push(`/push/user/${userId}/profile`, { v: 1, pseudo }, current?.hash ?? null);
}
