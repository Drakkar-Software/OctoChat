import { beforeEach, describe, expect, it, vi } from 'vitest';

// tickRoom's content-hash gate is the layer that actually prevents a duplicate
// post (hash.test.ts only covers the pure `dedupeFetch` decision). Exercise the
// real gate by stubbing its three side-effects: secret load, the bot post, and
// the ephemeral keypair mint. The provider is a test double returning fixed text.
vi.mock('./secrets', () => ({ loadAutomationSecrets: vi.fn(async () => ({})) }));
vi.mock('./append', () => ({ appendAsBot: vi.fn(async () => undefined) }));
// Stub the credential opener so the test doesn't pull the seal/keyring graph — it just
// hands back the (plaintext) stored credential, which is all the post path needs here.
vi.mock('../starfish/stream-bots', () => ({
  openStreamBotCredential: vi.fn(async (_session: unknown, stored: unknown) => stored),
}));
vi.mock('@drakkar.software/starfish-identities', () => ({
  generateDeviceKeys: vi.fn(async () => ({ edPub: 'bot-pub', edPriv: 'bot-priv' })),
}));

import { appendAsBot } from './append';
import { hashContent } from './hash';
import { tickRoom, type TickKind } from './runner-core';
import type { AutomationProvider, RunResult } from './types';
import type { Session } from '@/lib/starfish/identity';
import type { AutomationMeta, Room } from '../types';

const TEXT = 'GET https://x.test/s → 200\nlive';

const session = { userId: 'u1' } as unknown as Session;

const provider = (result: RunResult = { text: TEXT }): AutomationProvider =>
  ({
    id: 'http',
    name: 'HTTP',
    iconName: 'refresh',
    description: 'd',
    defaults: {},
    paramFields: [],
    fetch: vi.fn(async () => result),
    onCommand: vi.fn(async () => result),
  }) as unknown as AutomationProvider;

const META: AutomationMeta = {
  providerId: 'http',
  params: {},
  intervalMin: 15,
  enabled: true,
  // A legacy PLAINTEXT credential — the mocked opener returns it as-is (post path uses token).
  credential: { token: 't', endpoint: 'e', signPath: '/push/x' } as unknown as AutomationMeta['credential'],
  runOnDeviceId: 'device-A',
  lastRunAt: 1_000,
  lastError: null,
};

const room = (over: Partial<AutomationMeta> = {}): Room => ({
  id: 'r1',
  spaceId: 'psp-1',
  category: 'AUTOMATIONS',
  name: 'a',
  kind: 'automated',
  automation: { ...META, ...over },
});

const tick = (over: Partial<Parameters<typeof tickRoom>[0]> = {}) =>
  tickRoom({ session, room: room(), provider: provider(), trigger: 'scheduled', now: 5_000, ...over });

beforeEach(() => vi.mocked(appendAsBot).mockClear());

describe('tickRoom content-hash gate', () => {
  it('skips the post when the fetched text matches lastFetchHash', async () => {
    const out = await tick({ room: room({ lastFetchHash: hashContent(TEXT) }) });
    expect(out).toEqual({ kind: 'skipped' });
    expect(appendAsBot).not.toHaveBeenCalled();
  });

  it('posts and records the new hash when content changed', async () => {
    const out = await tick({ room: room({ lastFetchHash: 'stale' }) });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: hashContent(TEXT) });
    expect(appendAsBot).toHaveBeenCalledOnce();
  });

  it('posts on first run (no prior hash) and records the hash', async () => {
    const out = await tick({ room: room({ lastFetchHash: undefined }) });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: hashContent(TEXT) });
    expect(appendAsBot).toHaveBeenCalledOnce();
  });

  it('force bypasses the gate on unchanged content but still records the hash', async () => {
    const out = await tick({ room: room({ lastFetchHash: hashContent(TEXT) }), force: true });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: hashContent(TEXT) });
    expect(appendAsBot).toHaveBeenCalledOnce();
  });

  it('command posts always fire and never carry a fetch hash', async () => {
    const cmd: TickKind = { kind: 'command', cmd: 'get', args: ['x'] };
    const out = await tick({ room: room({ lastFetchHash: hashContent(TEXT) }), trigger: cmd });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: undefined });
    expect(appendAsBot).toHaveBeenCalledOnce();
  });

  it('a provider skip never posts', async () => {
    const out = await tick({ provider: provider({ skip: true }) });
    expect(out).toEqual({ kind: 'skipped' });
    expect(appendAsBot).not.toHaveBeenCalled();
  });
});
