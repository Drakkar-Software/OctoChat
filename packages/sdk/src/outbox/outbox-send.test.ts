import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getSpaceClient: vi.fn(() => mockClient),
    getNodeStreamClient: vi.fn(() => mockClient),
    buildNodeAccess: vi.fn(async () => null),
  };
});
vi.mock('../starfish/object-index', () => ({ readIndexRooms: vi.fn() }));

const mockAppend = vi.fn(async () => undefined);
const mockClient = { append: mockAppend };

import { sendQueued } from './outbox-send';
import { buildNodeAccess, getSpaceClient } from '@drakkar.software/starfish-spaces';
import { clearBuildNodeAccessCache } from '../starfish/node-access-cache';
import { readIndexRooms } from '../starfish/object-index';
import type { OutboxMessage } from './outbox-types';
import { makeMockSession } from '../test-utils/mock-session';

const SESSION = makeMockSession({ userId: 'u1' });

const entry = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: 'msg-1',
  roomId: 'sp-abc-general',
  spaceId: 'sp-abc',
  kind: 'channel',
  authorId: 'u1',
  text: 'hello',
  ts: 1000,
  status: 'queued',
  attempts: 0,
  ...over,
});

const rooms = (access: string, enc: boolean) => ({
  rooms: [{ id: 'sp-abc-general', spaceId: 'sp-abc', access, enc, kind: 'channel' }],
  categories: [],
});

beforeEach(() => {
  vi.mocked(mockAppend).mockClear();
  vi.mocked(readIndexRooms).mockResolvedValue(null);
  vi.mocked(buildNodeAccess).mockResolvedValue(null);
  clearBuildNodeAccessCache();
});

describe('sendQueued — index unavailable', () => {
  it('throws when readIndexRooms returns null (message stays queued)', async () => {
    vi.mocked(readIndexRooms).mockResolvedValue(null);
    await expect(sendQueued(SESSION, entry())).rejects.toThrow('Room index unavailable');
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('throws when room is absent from a valid index (does not fall through to plaintext)', async () => {
    // A valid index with a DIFFERENT room — the target roomId is not present.
    vi.mocked(readIndexRooms).mockResolvedValue({
      rooms: [{ id: 'sp-abc-other', spaceId: 'sp-abc', access: 'space', enc: true, kind: 'channel' }],
      categories: [],
    } as never);
    await expect(sendQueued(SESSION, entry())).rejects.toThrow('Room not found in index');
    expect(mockAppend).not.toHaveBeenCalled();
  });
});

describe('sendQueued — enc room', () => {
  it('throws when buildNodeAccess returns null (keyring unavailable)', async () => {
    vi.mocked(readIndexRooms).mockResolvedValue(rooms('space', true) as never);
    vi.mocked(buildNodeAccess).mockResolvedValue(null);
    await expect(sendQueued(SESSION, entry())).rejects.toThrow('No keyring access');
  });

  it('uses the enc client and encryptor from buildNodeAccess', async () => {
    const encClient = { append: vi.fn(async () => undefined) };
    const encryptor = { encrypt: vi.fn(async (d: unknown) => d) };
    vi.mocked(readIndexRooms).mockResolvedValue(rooms('space', true) as never);
    vi.mocked(buildNodeAccess).mockResolvedValue({ client: encClient, encryptor } as never);
    await sendQueued(SESSION, entry());
    expect(encClient.append).toHaveBeenCalledOnce();
    expect(encryptor.encrypt).toHaveBeenCalledOnce();
    expect(mockAppend).not.toHaveBeenCalled(); // spaceClient.append not used
  });

  it('E2EE ticket (invite + enc): seals via the NODE keyring, appends to the cap-gated invite stream', async () => {
    const encClient = { append: vi.fn(async () => undefined) }; // node content client (must NOT be used for the stream)
    const encryptor = { encrypt: vi.fn(async () => ({ _encrypted: 'ct' })) };
    vi.mocked(readIndexRooms).mockResolvedValue(rooms('invite', true) as never);
    vi.mocked(buildNodeAccess).mockResolvedValue({ client: encClient, encryptor } as never);
    await sendQueued(SESSION, entry());
    // SDK was told the access tier so it opens the per-node keyring (not the space keyring).
    expect(buildNodeAccess).toHaveBeenCalledWith(SESSION, 'sp-abc', 'sp-abc-general', { access: 'invite', enc: true });
    // Body is sealed (ciphertext), not plaintext.
    expect(encryptor.encrypt).toHaveBeenCalledOnce();
    // Appended via the per-node STREAM client (objinvlog, path contains /n/), NOT access.client.
    const [pushPath, body] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).toContain('/n/');
    expect(body).toEqual({ _encrypted: 'ct' });
    expect(encClient.append).not.toHaveBeenCalled();
  });
});

describe('sendQueued — plaintext routing', () => {
  it('routes a public room to objpublog (path contains /pub/ and ends in /log)', async () => {
    vi.mocked(readIndexRooms).mockResolvedValue(rooms('public', false) as never);
    await sendQueued(SESSION, entry());
    const [pushPath] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).toContain('/pub/');
    expect(pushPath).toContain('/log');
  });

  it('routes an invite-plaintext room to objinvlog (path contains /n/)', async () => {
    vi.mocked(readIndexRooms).mockResolvedValue(rooms('invite', false) as never);
    await sendQueued(SESSION, entry());
    const [pushPath] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).toContain('/n/');
  });

  it('routes a private room to objlog (path contains /objects/logs/, no pub/ or /n/)', async () => {
    vi.mocked(readIndexRooms).mockResolvedValue(rooms('space', false) as never);
    await sendQueued(SESSION, entry());
    const [pushPath] = mockAppend.mock.calls[0] as [string, unknown];
    expect(pushPath).not.toContain('pub/');
    expect(pushPath).not.toContain('/n/');
    expect(pushPath).toContain('/objects/logs/');
  });
});
