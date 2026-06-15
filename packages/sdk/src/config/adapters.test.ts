/**
 * Tests for the OctoChat KV adapter seam.
 * Key invariants: configureKv wires both local + octospaces-sdk seams;
 * getKv() throws before configuration; kvGet/Set/Remove delegate correctly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/octospaces-sdk')>();
  return { ...actual, configureKv: vi.fn() };
});

import { configureKv as octospacesConfigure } from '@drakkar.software/octospaces-sdk';
import { configureKv, kvGet, kvSet, kvRemove } from './adapters';

beforeEach(() => vi.clearAllMocks());

describe('configureKv', () => {
  it('wires the octospaces-sdk KV seam with the same adapter', () => {
    const adapter = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    configureKv(adapter);
    expect(octospacesConfigure).toHaveBeenCalledOnce();
    const sdkAdapter = vi.mocked(octospacesConfigure).mock.calls[0]![0];
    expect(sdkAdapter.get).toBe(adapter.get);
    expect(sdkAdapter.set).toBe(adapter.set);
    expect(sdkAdapter.remove).toBe(adapter.remove);
  });
});

describe('kvGet / kvSet / kvRemove', () => {
  it('delegates to the configured adapter', async () => {
    const store = new Map<string, string>();
    configureKv({
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      remove: async (k) => void store.delete(k),
    });

    await kvSet('k', 'v');
    expect(await kvGet('k')).toBe('v');
    await kvRemove('k');
    expect(await kvGet('k')).toBeNull();
  });
});
