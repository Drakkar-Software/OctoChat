/**
 * Identity & 12-word recovery seed. The seed is a BIP-39 mnemonic used as the
 * passphrase for Starfish's `bootstrapRootIdentity`; the same words deterministically
 * recover the identity. Device credentials (not the words) are what get persisted.
 */
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bootstrapRootIdentity, mintDeviceCap } from '@drakkar.software/starfish-identities';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import { makeClient, ensurePseudo, type DeviceKeys } from './client';
import { accountScope, ownerScope } from './paths';

export interface Session {
  userId: string;
  name: string;
  keys: DeviceKeys;
  chatCap: unknown;
  accountCap: unknown;
  chatClient: StarfishClient;
  accountClient: StarfishClient;
  fingerprint: string;
}

/** Fresh 12-word recovery seed. */
export function generateSeedWords(): string[] {
  return generateMnemonic(wordlist, 128).split(' ');
}

export function isValidSeed(words: string[]): boolean {
  return validateMnemonic(words.join(' ').trim(), wordlist);
}

/** Human-readable fingerprint derived from the identity's user id. */
export function fingerprintFromUserId(userId: string): string {
  const h = userId.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return [h.slice(0, 4), h.slice(4, 8), h.slice(8, 12)].filter(Boolean).join(' · ');
}

/** Derive a full owner session (identity + caps + clients) from a seed. */
export async function deriveSession(seedWords: string[], name?: string): Promise<Session> {
  const passphrase = seedWords.join(' ').trim();
  const creds = await bootstrapRootIdentity(passphrase);
  const keys = creds.device as DeviceKeys;
  const fallback = name && name.trim() ? name.trim() : `octo-${creds.userId.slice(0, 6)}`;
  const sub = { edPubHex: keys.edPub, kemPubHex: keys.kemPub };
  const chatCap = await mintDeviceCap(keys.edPriv, keys.edPub, sub, ownerScope());
  const accountCap = await mintDeviceCap(keys.edPriv, keys.edPub, sub, accountScope(creds.userId));
  const chatClient = makeClient(chatCap, keys.edPriv);
  const accountClient = makeClient(accountCap, keys.edPriv);
  // Adopt the stored pseudo if the profile already exists; only seed `fallback`
  // for a brand-new identity. Never overwrite — a blind write here would revert
  // an edit made on another device back to the bootstrap default on every open.
  const displayName = await ensurePseudo(accountClient, creds.userId, fallback).catch(() => fallback);
  return {
    userId: creds.userId,
    name: displayName,
    keys,
    chatCap,
    accountCap,
    chatClient,
    accountClient,
    fingerprint: fingerprintFromUserId(creds.userId),
  };
}
