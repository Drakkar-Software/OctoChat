/**
 * Starfish client construction + room keyring/encryptor helpers.
 *
 * Most helpers (makeClient, capProviderFor, profile R/W, auth headers) are
 * thin re-exports from @drakkar.software/octospaces-sdk — they use the same
 * configureOctoSpaces / configureKv setup OctoChat wires at boot.
 *
 * openEncryptor / buildEncryptor are OctoChat-flavored wrappers: they take a
 * `spaceId` string and construct the keyring pull path internally, so callers
 * in members.ts don't need to import keyringPull separately.
 */
import type { Encryptor } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import {
  openEncryptor as _openEncryptor,
  buildEncryptor as _buildEncryptor,
} from '@drakkar.software/octospaces-sdk';
import type { DeviceKeys } from '@drakkar.software/octospaces-sdk';

import { keyringPull } from './paths';

export type { DeviceKeys, PublicProfile } from '@drakkar.software/octospaces-sdk';

export {
  capProviderFor,
  makeClient,
  ownerEnsureKeyring,
  readProfile,
  readPseudo,
  readProfiles,
  writeProfile,
  writePseudo,
  ensureProfileKeys,
  buildAuthHeaders,
  ensurePseudo,
} from '@drakkar.software/octospaces-sdk';

/**
 * Open a space's decryptor by spaceId, throwing a descriptive error per failure mode.
 * Wraps octospaces-sdk's path-based openEncryptor using keyringPull(spaceId).
 */
export async function openEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[],
): Promise<Encryptor> {
  return _openEncryptor(client, keys, keyringPull(spaceId), trustedAdders);
}

/** Soft variant of {@link openEncryptor}: returns null instead of throwing. */
export async function buildEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  trustedAdders: string[],
): Promise<Encryptor | null> {
  return _buildEncryptor(client, keys, keyringPull(spaceId), trustedAdders);
}
