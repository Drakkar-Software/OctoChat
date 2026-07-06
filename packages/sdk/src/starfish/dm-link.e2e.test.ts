/**
 * END-TO-END: the full "DM me" link loop against a REAL OctoChat server —
 * derive the identity link → a stranger (no shared space) opens it and creates
 * the DM via an ANONYMOUS signed append → the owner auto-accepts on reconcile.
 * Also pins the inbox's access posture: owner-only reads, key-tamper rejection.
 *
 * Skipped unless `STARFISH_E2E=<server base url>` (e.g. `http://127.0.0.1:8799`)
 * points at a running `apps/server` (fresh data dir recommended; no NATS needed).
 * Kept as a guarded test so the loop stays one command away:
 *
 *   STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
 *   STARFISH_E2E=http://127.0.0.1:8799 pnpm --filter @drakkar.software/octochat-sdk test dm-link.e2e
 */
import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { configureOctoChat } from '../config/config';
import { configureKv } from '../config/adapters';

import { reconcileDmInbox } from './dm';
import { readPeerKeys } from './dm-keys';
import { decodeIdentityLink, myIdentityLink } from '@drakkar.software/starfish-spaces';
import { createDmViaLink } from './dm-link';
import { buildSession, type Session } from './identity';
import { dmInboxShard, inboxPull, userIdFromEdPub } from './paths';
import { readSpaces } from './registry';

const BASE = process.env.STARFISH_E2E;

const userIdOf = userIdFromEdPub;

/** A fresh root-device session, waited until its profile keys are PUBLISHED —
 *  buildSession fires ensureProfileKeys in the background (a second explicit call
 *  would just race it into a 409), so poll the public profile like a peer would.
 *  (The publish matters here: createDmViaLink cross-checks link keys against it.) */
async function newUser(name: string): Promise<Session> {
  const keys = generateDeviceKeys();
  const userId = await userIdOf(keys.edPub);
  const session = await buildSession({ userId, keys }, name);
  for (let i = 0; i < 50; i++) {
    if (await readPeerKeys(userId)) return session;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`profile keys for ${name} never published`);
}

describe.skipIf(!BASE)('dm-link end-to-end (STARFISH_E2E)', () => {
  it('runs the whole loop: identity link → anonymous delivery → auto-accept', { timeout: 120_000 }, async () => {
    configureOctoChat({ syncBase: BASE! });
    const mem = new Map<string, string>();
    configureKv({
      get: async (k) => mem.get(k) ?? null,
      set: async (k, v) => void mem.set(k, v),
      remove: async (k) => void mem.delete(k),
    });

    const alice = await newUser('Alice');
    const bob = await newUser('Bob');

    // Alice's link is derived, permanent, and embeds her published identity.
    const link = await myIdentityLink(alice, 'https://oc.test', 'dm');
    expect(link!.startsWith('https://oc.test/dm#')).toBe(true);
    const token = decodeIdentityLink(link!.slice(link!.indexOf('#') + 1));
    expect(token).toMatchObject({ v: 2, ownerId: alice.userId, pseudo: 'Alice', edPub: alice.keys.edPub, kemPub: alice.keys.kemPub });
    expect(typeof token.kemSig).toBe('string');

    // Bob — who shares NO space with Alice — starts the DM through the link.
    const ref = await createDmViaLink(bob, token, 'Alice');
    expect((await readSpaces(bob.accountClient, bob.userId)).dms[alice.userId]).toBe(ref.spaceId);
    // Re-opening the same link dedups into the same conversation.
    expect((await createDmViaLink(bob, token, 'Alice')).spaceId).toBe(ref.spaceId);

    // Alice's reconcile (the app runs it on load/navigation/foreground) accepts
    // the invite — keyring access verified — and maps the DM. Idempotent after.
    expect(await reconcileDmInbox(alice, [])).toBe(true);
    expect((await readSpaces(alice.accountClient, alice.userId)).dms[bob.userId]).toBe(ref.spaceId);
    expect(await reconcileDmInbox(alice, [])).toBe(false);

    // ACCESS POSTURE — the inbox shard is owner-read only: Bob's authenticated pull
    // is rejected (his cap's path scope doesn't cover Alice's inbox)…
    const shard = dmInboxShard();
    await expect(bob.accountClient.pull(inboxPull(alice.userId, shard))).rejects.toThrow();
    // …and so is an anonymous read (`public` is not in readRoles).
    const anon = await fetch(`${BASE}${inboxPull(alice.userId, shard)}`);
    expect(anon.status).toBeGreaterThanOrEqual(400);

    // KEY BINDING — a tampered link (kem key swapped) fails against the profile.
    const charlie = await newUser('Charlie');
    const evil = generateDeviceKeys();
    await expect(createDmViaLink(charlie, { ...token, kemPub: evil.kemPub }, 'Alice')).rejects.toThrow(
      /published identity keys/,
    );
    // …and a routing-id mismatch fails offline (ownerId is the hash of edPub).
    await expect(createDmViaLink(charlie, { ...token, ownerId: 'f'.repeat(32) }, 'Alice')).rejects.toThrow(/malformed/);
  });
});
