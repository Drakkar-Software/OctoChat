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

/** Build a decryptor from a room's keyring, or null if absent / not a recipient. */
export async function buildEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  roomId: string,
): Promise<Encryptor | null> {
  try {
    const res = await client.pull(keyringPull(roomId));
    const keyring = res?.data as unknown as Keyring | undefined;
    if (!keyring || !keyring.epochs) return null;
    const enc = await createKeyringEncryptor(keyring, { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv });
    return enc as unknown as Encryptor;
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
  const enc = await createKeyringEncryptor(keyring, { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv });
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
    const ownerEnc = await buildEncryptor(client, keys, roomId);
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
