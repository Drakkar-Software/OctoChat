import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppend = vi.fn(async () => undefined);
const mockPull = vi.fn(async () => [] as unknown[]);

vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildNodeAccess: vi.fn(),
  ownerEnsureNodeKeyring: vi.fn(),
  getNodeStreamClient: vi.fn(() => ({ append: mockAppend, pull: mockPull })),
}));

import { writeSealedTicketInfo, readSealedTicketInfo } from './ticket-info';
import { buildNodeAccess, ownerEnsureNodeKeyring } from '@drakkar.software/starfish-spaces';
import { clearBuildNodeAccessCache } from '../starfish/node-access-cache';
import type { Session } from '../starfish/identity';

const session = { userId: 'u1' } as unknown as Session;
// An encryptor that wraps/unwraps so we can assert the body is SEALED (not plaintext).
const encryptor = {
  encrypt: vi.fn(async (d: Record<string, unknown>) => ({ _ct: JSON.stringify(d) })),
  decrypt: vi.fn(async (d: Record<string, unknown>) => JSON.parse((d as { _ct: string })._ct)),
};

beforeEach(() => {
  mockAppend.mockClear();
  mockPull.mockClear().mockResolvedValue([]);
  encryptor.encrypt.mockClear();
  encryptor.decrypt.mockClear();
  // Regular member/participant path: buildNodeAccess resolves the invite+enc encryptor.
  vi.mocked(buildNodeAccess).mockResolvedValue({ client: {}, encryptor } as never);
  // Owner path: ownerEnsureNodeKeyring returns an encryptor directly (used by writeSealedTicketInfo
  // and as fallback in readSealedTicketInfo when buildNodeAccess returns null).
  vi.mocked(ownerEnsureNodeKeyring).mockResolvedValue(encryptor as never);
  clearBuildNodeAccessCache();
});

describe('writeSealedTicketInfo', () => {
  it('seals title+requester via ownerEnsureNodeKeyring and appends to the invite stream', async () => {
    await writeSealedTicketInfo(session, 'sp-1', 'ticket-1', { title: 'Subject', requester: 'a@b.c' });
    expect(ownerEnsureNodeKeyring).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1');
    expect(encryptor.encrypt).toHaveBeenCalledOnce();
    const [pushPath, body] = mockAppend.mock.calls[0] as [string, { _ct?: string; e?: unknown }];
    expect(pushPath).toContain('/n/'); // objinvlog
    expect(body._ct).toBeDefined();    // ciphertext
    expect(body.e).toBeUndefined();    // no plaintext envelope
  });

  it('throws when ownerEnsureNodeKeyring rejects (no node keyring)', async () => {
    vi.mocked(ownerEnsureNodeKeyring).mockRejectedValue(new Error('no keyring'));
    await expect(writeSealedTicketInfo(session, 'sp-1', 'ticket-1', { title: 'x', requester: 'y' })).rejects.toThrow();
  });
});

describe('readSealedTicketInfo', () => {
  it('passes { appendField: "items", full: true } to client.pull (400 regression guard)', async () => {
    await readSealedTicketInfo(session, 'sp-1', 'ticket-1');
    expect(mockPull).toHaveBeenCalledWith(
      expect.stringContaining('/n/'),
      { appendField: 'items', full: true },
    );
  });

  it('finds and decrypts the ticket-info header from the stream (member path)', async () => {
    const sealed = { _ct: JSON.stringify({ t: 'ticket-info', e: { title: 'Subject', requester: 'a@b.c' } }) };
    mockPull.mockResolvedValue([sealed]);
    const info = await readSealedTicketInfo(session, 'sp-1', 'ticket-1');
    expect(info).toEqual({ title: 'Subject', requester: 'a@b.c' });
  });

  it('falls back to ownerEnsureNodeKeyring when buildNodeAccess returns null (owner path)', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(null as never);
    const sealed = { _ct: JSON.stringify({ t: 'ticket-info', e: { title: 'Owner Subject', requester: 'r@b.c' } }) };
    mockPull.mockResolvedValue([sealed]);
    const info = await readSealedTicketInfo(session, 'sp-1', 'ticket-1');
    expect(ownerEnsureNodeKeyring).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1');
    expect(info).toEqual({ title: 'Owner Subject', requester: 'r@b.c' });
  });

  it('returns null when the caller is neither a participant nor the owner', async () => {
    vi.mocked(buildNodeAccess).mockResolvedValue(null as never);
    vi.mocked(ownerEnsureNodeKeyring).mockRejectedValue(new Error('not owner'));
    expect(await readSealedTicketInfo(session, 'sp-1', 'ticket-1')).toBeNull();
  });

  it('returns null when no ticket-info header is present', async () => {
    const other = { _ct: JSON.stringify({ t: 'msg', e: { text: 'hi' } }) };
    mockPull.mockResolvedValue([other]);
    expect(await readSealedTicketInfo(session, 'sp-1', 'ticket-1')).toBeNull();
  });
});
