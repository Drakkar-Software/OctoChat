/**
 * variant-store — unit tests.
 *
 * The bug this suite guards against: `spaces-context.tsx` previously gated
 * `reconcileTicketRequests` on a BUILD-TIME module-level constant
 *   `const DESK_INTAKE = activeVariant.features.includes('tickets')`
 * The fix reads the live runtime snapshot on every `refresh()` call instead:
 *   `VARIANTS[getActiveVariantId()].features.includes('tickets')`
 *
 * These tests verify that the runtime snapshot correctly tracks variant switches
 * (in-app switcher / KV persistence) so the feature gate stays accurate even
 * when the installed binary is the default `octochat` build.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@drakkar.software/octochat-sdk', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

import { kvGet, kvSet } from '@drakkar.software/octochat-sdk';
import { ACTIVE_VARIANT, VARIANTS } from './variants';
import {
  getActiveVariantId,
  loadVariantId,
  saveVariantId,
  setActiveVariantId,
  subscribeVariant,
} from './variant-store';

// The store holds module-level mutable state; reset to the build-time seed between tests.
beforeEach(() => {
  vi.clearAllMocks();
  setActiveVariantId(ACTIVE_VARIANT);
});

// ── snapshot get/set ──────────────────────────────────────────────────────────

describe('getActiveVariantId / setActiveVariantId', () => {
  it('starts at ACTIVE_VARIANT (the build-time env seed)', () => {
    expect(getActiveVariantId()).toBe(ACTIVE_VARIANT);
  });

  it('reflects the new variant immediately after setActiveVariantId', () => {
    setActiveVariantId('octodesk');
    expect(getActiveVariantId()).toBe('octodesk');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeVariant(cb);
    setActiveVariantId('octodesk');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setActiveVariantId(ACTIVE_VARIANT); // should NOT fire again
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ── the runtime feature gate (the regression target) ─────────────────────────

describe('feature gate — tickets capability is RUNTIME not build-time', () => {
  it('octochat has NO tickets capability (root cause context: a build-time gate on this is always false)', () => {
    // This is what made the bug invisible in production octodesk builds but broken on
    // default octochat builds switched to OctoDesk at runtime.
    expect(VARIANTS['octochat'].features.includes('tickets')).toBe(false);
  });

  it('switching to octodesk at runtime unlocks the tickets gate', () => {
    setActiveVariantId('octodesk');
    expect(VARIANTS[getActiveVariantId()].features.includes('tickets')).toBe(true);
  });

  it('switching to octopulse at runtime also unlocks tickets', () => {
    setActiveVariantId('octopulse');
    expect(VARIANTS[getActiveVariantId()].features.includes('tickets')).toBe(true);
  });

  it('resetting to octochat drops the gate back to false', () => {
    setActiveVariantId('octodesk');
    setActiveVariantId('octochat');
    expect(VARIANTS[getActiveVariantId()].features.includes('tickets')).toBe(false);
  });
});

// ── KV persistence ────────────────────────────────────────────────────────────

describe('loadVariantId', () => {
  it('returns the persisted variant when KV has a valid value', async () => {
    vi.mocked(kvGet).mockResolvedValue('octodesk');
    expect(await loadVariantId()).toBe('octodesk');
  });

  it('falls back to ACTIVE_VARIANT when KV is empty (null)', async () => {
    vi.mocked(kvGet).mockResolvedValue(null);
    expect(await loadVariantId()).toBe(ACTIVE_VARIANT);
  });

  it('ignores unknown/invalid values from KV and falls back to ACTIVE_VARIANT', async () => {
    vi.mocked(kvGet).mockResolvedValue('some-old-unknown-variant');
    expect(await loadVariantId()).toBe(ACTIVE_VARIANT);
  });
});

describe('saveVariantId', () => {
  it('updates the in-memory snapshot immediately AND writes to KV', async () => {
    vi.mocked(kvSet).mockResolvedValue(undefined);
    await saveVariantId('octodesk');
    expect(getActiveVariantId()).toBe('octodesk');
    expect(kvSet).toHaveBeenCalledWith('octochat.variant', 'octodesk');
  });
});
