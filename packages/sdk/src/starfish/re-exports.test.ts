/**
 * Parity tests for OctoChat thin re-export barrels.
 *
 * These files contain no local logic — they re-export from octospaces-sdk.
 * These tests pin the exported names and any critical constants so a future SDK
 * change that drops or renames an export fails loudly here rather than silently
 * at the app call sites.
 */
import { describe, expect, it } from 'vitest';

import * as sdk from '@drakkar.software/octospaces-sdk';

// ── account-seal ──────────────────────────────────────────────────────────────
import * as accountSeal from './account-seal';

describe('account-seal re-exports', () => {
  it('exports the four seal helpers', () => {
    expect(typeof accountSeal.sealToSelf).toBe('function');
    expect(typeof accountSeal.unsealFromSelf).toBe('function');
    expect(typeof accountSeal.sealToRecipient).toBe('function');
    expect(typeof accountSeal.unsealFromRecipient).toBe('function');
  });

  it('is parity with octospaces-sdk (same function references)', () => {
    expect(accountSeal.sealToSelf).toBe(sdk.sealToSelf);
    expect(accountSeal.unsealFromSelf).toBe(sdk.unsealFromSelf);
  });
});

// ── session-restore ───────────────────────────────────────────────────────────
// session-restore.ts deleted — import directly from octospaces-sdk
import { sessionFromPersisted, activeAccountOf } from '@drakkar.software/octospaces-sdk';

describe('session-restore re-exports', () => {
  it('exports sessionFromPersisted and activeAccountOf', () => {
    expect(typeof sessionFromPersisted).toBe('function');
    expect(typeof activeAccountOf).toBe('function');
  });

  it('is parity with octospaces-sdk', () => {
    expect(sessionFromPersisted).toBe(sdk.sessionFromPersisted);
    expect(activeAccountOf).toBe(sdk.activeAccountOf);
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

  it('is parity with octospaces-sdk', () => {
    expect(identity.buildSession).toBe(sdk.buildSession);
    expect(identity.generateSeedWords).toBe(sdk.generateSeedWords);
  });
});

// ── space-access-error ────────────────────────────────────────────────────────
import { SpaceAccessError } from './space-access-error';

describe('space-access-error re-exports', () => {
  it('SpaceAccessError is the same class as the SDK export', () => {
    expect(SpaceAccessError).toBe(sdk.SpaceAccessError);
  });

  it('instanceof works across the re-export boundary', () => {
    const err = new SpaceAccessError('test');
    expect(err).toBeInstanceOf(SpaceAccessError);
    expect(err).toBeInstanceOf(sdk.SpaceAccessError);
    expect(err.message).toBe('test');
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

  it('is parity with octospaces-sdk', () => {
    expect(fetchTimeout.fetchWithTimeout).toBe(sdk.fetchWithTimeout);
    expect(fetchTimeout.CONNECT_TIMEOUT_MS).toBe(sdk.CONNECT_TIMEOUT_MS);
  });
});
