/**
 * Parity tests for OctoChat thin re-export barrels.
 *
 * These files contain no local logic — they re-export from dk-spaces-sdk or
 * starfish-spaces. These tests pin the exported names and any critical constants
 * so a future SDK change that drops or renames an export fails loudly here
 * rather than silently at the app call sites.
 *
 * NOTE (0.25 migration): Several symbols moved from octospaces-sdk → starfish-spaces:
 * - sealToSelf / unsealFromSelf / sealToRecipient / unsealFromRecipient
 * - buildSession / buildLinkedSession / ownerTrustedAdders / generateSeedWords / isValidSeed / fingerprintFromUserId
 * - SpaceAccessError
 * fetchWithTimeout / CONNECT_TIMEOUT_MS were removed from octospaces-sdk in 0.24
 * and are now locally reimplemented in fetch-timeout.ts via createTimeoutFetch.
 *
 * NOTE (0.31/0.32 migration): dk-spaces-sdk dropped its remaining starfish proxies —
 * sessionFromPersisted / activeAccountOf / rootIdentityOf now come directly from
 * starfish-spaces. sessionFromPersisted is wrapped locally (identity.ts) to inject
 * `clientOpts`, so it's no longer the same function reference as the starfish-spaces
 * export (see the identity re-exports block below for the same wrapper pattern).
 */
import { describe, expect, it } from 'vitest';

import * as spaces from '@drakkar.software/starfish-spaces';

// ── account-seal ──────────────────────────────────────────────────────────────
import * as accountSeal from './account-seal';

describe('account-seal re-exports', () => {
  it('exports the four seal helpers', () => {
    expect(typeof accountSeal.sealToSelf).toBe('function');
    expect(typeof accountSeal.unsealFromSelf).toBe('function');
    expect(typeof accountSeal.sealToRecipient).toBe('function');
    expect(typeof accountSeal.unsealFromRecipient).toBe('function');
  });

  it('is parity with starfish-spaces (same function references)', () => {
    expect(accountSeal.sealToSelf).toBe(spaces.sealToSelf);
    expect(accountSeal.unsealFromSelf).toBe(spaces.unsealFromSelf);
  });
});

// ── session-restore ───────────────────────────────────────────────────────────
// session-restore.ts deleted — hoisted into barrel; import from barrel to guard re-export coverage
import { sessionFromPersisted, activeAccountOf } from '../index';

describe('session-restore re-exports', () => {
  it('exports sessionFromPersisted and activeAccountOf', () => {
    expect(typeof sessionFromPersisted).toBe('function');
    expect(typeof activeAccountOf).toBe('function');
  });

  it('is parity with starfish-spaces (activeAccountOf is a direct pass-through;' +
    ' sessionFromPersisted is a local clientOpts-injecting wrapper, not the same reference)', () => {
    expect(activeAccountOf).toBe(spaces.activeAccountOf);
    expect(sessionFromPersisted).not.toBe(spaces.sessionFromPersisted);
  });
});

// ── identity ──────────────────────────────────────────────────────────────────
import * as identity from './identity';

describe('identity re-exports', () => {
  it('exports all session helpers', () => {
    expect(typeof identity.buildSession).toBe('function');
    expect(typeof identity.buildLinkedSession).toBe('function');
    expect(typeof identity.generateSeedWords).toBe('function');
    expect(typeof identity.isValidSeed).toBe('function');
    expect(typeof identity.ownerTrustedAdders).toBe('function');
    expect(typeof identity.fingerprintFromUserId).toBe('function');
  });

  it('is parity with starfish-spaces for pass-through re-exports', () => {
    // generateSeedWords / isValidSeed / ownerTrustedAdders are direct re-exports
    expect(identity.generateSeedWords).toBe(spaces.generateSeedWords);
    expect(identity.ownerTrustedAdders).toBe(spaces.ownerTrustedAdders);
    // buildSession / buildLinkedSession are OctoChat wrappers (inject clientOpts),
    // not the same reference — just verify they exist and are functions.
    expect(typeof identity.buildSession).toBe('function');
    expect(typeof identity.buildLinkedSession).toBe('function');
  });
});

// ── space-access-error ────────────────────────────────────────────────────────
import { SpaceAccessError } from './space-access-error';

describe('space-access-error re-exports', () => {
  it('SpaceAccessError is the same class as the starfish-spaces export', () => {
    expect(SpaceAccessError).toBe(spaces.SpaceAccessError);
  });

  it('instanceof works across the re-export boundary', () => {
    // SpaceAccessError constructor in 0.25: (spaceId, nodeId?, message?)
    const err = new SpaceAccessError('sp-test');
    expect(err).toBeInstanceOf(SpaceAccessError);
    expect(err).toBeInstanceOf(spaces.SpaceAccessError);
    expect(err.message).toContain('sp-test');
  });
});

// ── fetch-timeout ─────────────────────────────────────────────────────────────
import * as fetchTimeout from './fetch-timeout';

describe('fetch-timeout re-exports', () => {
  it('exports fetchWithTimeout and CONNECT_TIMEOUT_MS', () => {
    expect(typeof fetchTimeout.fetchWithTimeout).toBe('function');
    expect(typeof fetchTimeout.CONNECT_TIMEOUT_MS).toBe('number');
    expect(fetchTimeout.CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  // fetchWithTimeout was removed from octospaces-sdk in 0.24 and is now locally
  // reimplemented via createTimeoutFetch — no parity check against the removed export.
  it('fetchWithTimeout returns a function (the timeout-wrapped fetch)', () => {
    expect(typeof fetchTimeout.fetchWithTimeout()).toBe('function');
  });
});
