/**
 * Identity & 12-word recovery seed. The seed is a BIP-39 mnemonic used as the
 * passphrase for Starfish's `bootstrapRootIdentity`; the same words deterministically
 * recover the identity. Device credentials (not the words) are what get persisted.
 */
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bootstrapRootIdentity, mintDeviceCap } from '@drakkar.software/starfish-identities';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { CapCert } from '@drakkar.software/starfish-protocol';

import { makeClient, ensureProfileKeys, ensurePseudo, type DeviceKeys } from './client';
import { accountScope, ownerScope } from './paths';
import type { DerivedIdentity } from './storage-types';

export interface Session {
  userId: string;
  name: string;
  keys: DeviceKeys;
  chatCap: unknown;
  accountCap: unknown;
  chatClient: StarfishClient;
  accountClient: StarfishClient;
  fingerprint: string;
  /**
   * The Ed25519 pubkey that signs this identity's OWNED-space keyring entries —
   * the trusted-adder provenance anchor for opening them. Equals {@link keys}.edPub
   * for a seed/Nostr session (device IS the root). For a PAIRED device it is the
   * ROOT's edPub (`capCert.iss`), because owned-space keyring entries — including
   * the one granting this device — were signed by the root, not by the device's
   * own key. See {@link ownerTrustedAdders}.
   */
  ownerEdPub: string;
}

/**
 * Trusted-adder allow-list for opening an OWNED space's keyring: the root's
 * signing key (which signed the keyring + its recipient adds) plus this device's
 * own key (covers the rare case where THIS device created the keyring for a space
 * the root never opened). Deduped — a seed session collapses to a single key.
 */
export function ownerTrustedAdders(session: Session): string[] {
  return session.ownerEdPub === session.keys.edPub
    ? [session.keys.edPub]
    : [session.ownerEdPub, session.keys.edPub];
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

/**
 * Build a full owner session (caps + clients + pseudo) from an already-derived
 * root identity. This is the cheap half of {@link deriveSession}: it does NO
 * Argon2id, only fast Ed25519 cap-minting plus a profile fetch. Restore paths
 * (unlock / cold-start) call this with cached keys so they pay the bootstrap
 * Argon2id once at sign-in, never again.
 */
export async function buildSession({ userId, keys }: DerivedIdentity, name?: string): Promise<Session> {
  const fallback = name && name.trim() ? name.trim() : `octo-${userId.slice(0, 6)}`;
  const sub = { edPubHex: keys.edPub, kemPubHex: keys.kemPub };
  const chatCap = await mintDeviceCap(keys.edPriv, keys.edPub, sub, ownerScope());
  const accountCap = await mintDeviceCap(keys.edPriv, keys.edPub, sub, accountScope(userId));
  const chatClient = makeClient(chatCap, keys.edPriv);
  const accountClient = makeClient(accountCap, keys.edPriv);
  // Adopt the stored pseudo if the profile already exists; only seed `fallback`
  // for a brand-new identity. Never overwrite — a blind write here would revert
  // an edit made on another device back to the bootstrap default on every open.
  const displayName = await ensurePseudo(accountClient, userId, fallback).catch(() => fallback);
  // Publish this identity's public keys so peers can discover them to start an E2EE
  // DM. Root-device only (profile is device:root-write) — buildLinkedSession skips it.
  // Best-effort + idempotent; never blocks sign-in.
  void ensureProfileKeys(accountClient, userId, keys).catch(() => {});
  return {
    userId,
    name: displayName,
    keys,
    chatCap,
    accountCap,
    chatClient,
    accountClient,
    fingerprint: fingerprintFromUserId(userId),
    // Seed/Nostr: the device key IS the root, so it's its own keyring-adder anchor.
    ownerEdPub: keys.edPub,
  };
}

/** A paired device's credentials: its own keypair + the root-signed cap-cert. */
export interface LinkedIdentity {
  userId: string;
  keys: DeviceKeys;
  capCert: CapCert;
}

/**
 * Build a session for a PAIRED (linked) device. Unlike {@link buildSession}, the
 * device keypair is NOT the root, so it cannot self-mint caps — both clients are
 * driven by the single root-signed `capCert` from the pairing bundle (provisioned
 * with `linkedDeviceScope`, broad enough to cover BOTH the chat and account
 * paths). `keys` are the device's own keypair, used for keyring unwrap and join
 * requests. No Argon2id — like {@link buildSession} this is the cheap path.
 */
export async function buildLinkedSession({ userId, keys, capCert }: LinkedIdentity, name?: string): Promise<Session> {
  const fallback = name && name.trim() ? name.trim() : `octo-${userId.slice(0, 6)}`;
  const chatClient = makeClient(capCert, keys.edPriv);
  const accountClient = makeClient(capCert, keys.edPriv);
  const displayName = await ensurePseudo(accountClient, userId, fallback).catch(() => fallback);
  return {
    userId,
    name: displayName,
    keys,
    chatCap: capCert,
    accountCap: capCert,
    chatClient,
    accountClient,
    fingerprint: fingerprintFromUserId(userId),
    // Paired device: owned-space keyring entries were signed by the ROOT, whose
    // edPub is the cap-cert issuer — NOT this device's fresh key.
    ownerEdPub: capCert.iss,
  };
}

/** Derive a full owner session (identity + caps + clients) from a seed. */
export async function deriveSession(seedWords: string[], name?: string): Promise<Session> {
  const passphrase = seedWords.join(' ').trim();
  const creds = await bootstrapRootIdentity(passphrase);
  return buildSession({ userId: creds.userId, keys: creds.device as DeviceKeys }, name);
}

/** The cached root identity (userId + keys) carried by a built session. */
export function rootIdentityOf(s: Session): DerivedIdentity {
  return { userId: s.userId, keys: s.keys };
}
