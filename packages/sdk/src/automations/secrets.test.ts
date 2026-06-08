import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../config/adapters', () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
  kvRemove: vi.fn(async (k: string) => {
    store.delete(k);
  }),
}));

import { clearAutomationSecrets, loadAutomationSecrets, saveAutomationSecrets } from './secrets';

beforeEach(() => store.clear());

describe('automation secrets kv', () => {
  it('round-trips a payload by (userId, roomId)', async () => {
    await saveAutomationSecrets('u1', 'r1', { apiKey: 'secret' });
    expect(await loadAutomationSecrets('u1', 'r1')).toEqual({ apiKey: 'secret' });
  });

  it('returns an empty object when nothing is stored', async () => {
    expect(await loadAutomationSecrets('u1', 'r-missing')).toEqual({});
  });

  it('isolates by userId', async () => {
    await saveAutomationSecrets('u1', 'r1', { a: 1 });
    expect(await loadAutomationSecrets('u2', 'r1')).toEqual({});
  });

  it('removes the entry when called with an empty record', async () => {
    await saveAutomationSecrets('u1', 'r1', { a: 1 });
    await saveAutomationSecrets('u1', 'r1', {});
    expect(await loadAutomationSecrets('u1', 'r1')).toEqual({});
  });

  it('clearAutomationSecrets drops the kv entry', async () => {
    await saveAutomationSecrets('u1', 'r1', { a: 1 });
    await clearAutomationSecrets('u1', 'r1');
    expect(await loadAutomationSecrets('u1', 'r1')).toEqual({});
  });

  it('tolerates corrupt json', async () => {
    store.set('octochat.automated.secrets.v1.u1.r1', '{not-json');
    expect(await loadAutomationSecrets('u1', 'r1')).toEqual({});
  });
});
