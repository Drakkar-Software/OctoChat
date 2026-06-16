import { beforeEach, describe, expect, it, vi } from 'vitest';

// tickRoom's content-hash gate and push-path routing. Exercise the real gate by
// stubbing the two side-effects: secret load and the space client append call.
const mockAppend = vi.fn(async () => undefined);
vi.mock('./secrets', () => ({ loadAutomationSecrets: vi.fn(async () => ({})) }));
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getSpaceClient: vi.fn(() => ({ append: mockAppend })),
    getNodeStreamClient: vi.fn(() => ({ append: mockAppend })),
    // E2EE ticket path: returns a node-keyring encryptor that wraps the envelope so the
    // test can assert the appended body is SEALED (not plaintext).
    buildNodeAccess: vi.fn(async () => ({
      client: { append: vi.fn() },
      encryptor: { encrypt: async (d: Record<string, unknown>) => ({ _sealed: d }) },
    })),
  };
});

import { hashContent } from './hash';
import { tickRoom, type TickKind } from './runner-core';
import type { AutomationProvider, RunResult } from './types';
import type { Session } from '@drakkar.software/octochat-sdk';
import type { AutomationMeta, Room } from '@drakkar.software/octochat-sdk';

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
  credential: {} as AutomationMeta['credential'],
  runOnDeviceId: 'device-A',
  lastRunAt: 1_000,
  lastError: null,
};

const room = (over: Partial<AutomationMeta> = {}, roomOver: Partial<Room> = {}): Room => ({
  id: 'r1',
  spaceId: 'sp-1',
  category: 'AUTOMATIONS',
  name: 'a',
  kind: 'automated',
  automation: { ...META, ...over },
  ...roomOver,
} as Room);

const tick = (over: Partial<Parameters<typeof tickRoom>[0]> = {}) =>
  tickRoom({ session, room: room(), provider: provider(), trigger: 'scheduled', now: 5_000, ...over });

beforeEach(() => mockAppend.mockClear());

describe('tickRoom content-hash gate', () => {
  it('skips the post when the fetched text matches lastFetchHash', async () => {
    const out = await tick({ room: room({ lastFetchHash: hashContent(TEXT) }) });
    expect(out).toEqual({ kind: 'skipped' });
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('posts and records the new hash when content changed', async () => {
    const out = await tick({ room: room({ lastFetchHash: 'stale' }) });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: hashContent(TEXT) });
    expect(mockAppend).toHaveBeenCalledOnce();
  });

  it('posts on first run (no prior hash) and records the hash', async () => {
    const out = await tick({ room: room({ lastFetchHash: undefined }) });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: hashContent(TEXT) });
    expect(mockAppend).toHaveBeenCalledOnce();
  });

  it('force bypasses the gate on unchanged content but still records the hash', async () => {
    const out = await tick({ room: room({ lastFetchHash: hashContent(TEXT) }), force: true });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: hashContent(TEXT) });
    expect(mockAppend).toHaveBeenCalledOnce();
  });

  it('command posts always fire and never carry a fetch hash', async () => {
    const cmd: TickKind = { kind: 'command', cmd: 'get', args: ['x'] };
    const out = await tick({ room: room({ lastFetchHash: hashContent(TEXT) }), trigger: cmd });
    expect(out).toEqual({ kind: 'posted', text: TEXT, hash: undefined });
    expect(mockAppend).toHaveBeenCalledOnce();
  });

  it('a provider skip never posts', async () => {
    const out = await tick({ provider: provider({ skip: true }) });
    expect(out).toEqual({ kind: 'skipped' });
    expect(mockAppend).not.toHaveBeenCalled();
  });
});

describe('tickRoom push-path routing', () => {
  it('routes a public room to objpublog (path contains /pub/ and ends in /log)', async () => {
    await tick({ room: room({}, { access: 'public', enc: false }) });
    const [pushPath] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).toContain('/pub/');
    expect(pushPath).toContain('/log');
    expect(pushPath).not.toContain('/n/');
  });

  it('routes an invite-plaintext room to objinvlog (path contains /n/)', async () => {
    await tick({ room: room({}, { access: 'invite', enc: false }) });
    const [pushPath] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).toContain('/n/');
    expect(pushPath).not.toContain('pub/');
  });

  it('E2EE ticket (invite + enc): SEALS the bot reply via the node keyring, posts to objinvlog', async () => {
    await tick({ room: room({}, { access: 'invite', enc: true }) });
    const [pushPath, body] = mockAppend.mock.calls[0] as [string, { _sealed?: unknown; e?: unknown }];
    expect(pushPath).toContain('/n/'); // cap-gated invite stream (objinvlog), not space objlog
    expect(pushPath).not.toContain('/objects/logs/');
    // Body is the sealed wrapper — the cleartext envelope is NOT posted directly.
    expect(body._sealed).toBeDefined();
    expect(body.e).toBeUndefined();
  });

  it('routes a private/space room to objlog (path contains /objects/logs/, no pub/ or /n/)', async () => {
    await tick({ room: room({}, { access: 'space', enc: false }) });
    const [pushPath] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).not.toContain('pub/');
    expect(pushPath).not.toContain('/n/');
    expect(pushPath).toContain('/objects/logs/');
  });

  it('posts via the session member-cap client (not an audience-cap/bot-token path)', async () => {
    // getSpaceClient is called once with the room's spaceId + session
    await tick({ room: room({}, { access: 'public', enc: false }) });
    expect(mockAppend).toHaveBeenCalledOnce();
    // The element body has the bot authorId and the result text
    const [, element] = mockAppend.mock.calls[0] as [string, { t: string; e: { authorId: string; text: string } }];
    expect(element.t).toBe('msg');
    expect(element.e.authorId).toMatch(/^bot-/);
    expect(element.e.text).toBe(TEXT);
  });
});
