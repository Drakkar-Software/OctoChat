import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  localSpaceAccessEntries: vi.fn(() => ({})),
}));

vi.mock('./ticket-info', () => ({
  readSealedTicketInfo: vi.fn(),
}));

import { getRequesterTicketForSpace } from './requester';
import { localSpaceAccessEntries } from '@drakkar.software/octospaces-sdk';
import { readSealedTicketInfo } from './ticket-info';
import type { Session } from '../starfish/identity';

const session = { userId: 'u1' } as unknown as Session;
const member = { kind: 'member', cap: 'c' } as const;

beforeEach(() => {
  vi.mocked(localSpaceAccessEntries).mockReset().mockReturnValue({});
  vi.mocked(readSealedTicketInfo).mockReset().mockResolvedValue(null);
});

describe('getRequesterTicketForSpace', () => {
  it('returns null when the store has no entries for the space', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-other:ticket-x': member,
    } as never);
    expect(await getRequesterTicketForSpace(session, 'sp-1')).toBeNull();
    expect(readSealedTicketInfo).not.toHaveBeenCalled();
  });

  it('returns null when the space has only non-ticket node grants', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-1': member, // space-level member entry (no colon)
      'sp-1:room-abc': member, // a non-ticket node
    } as never);
    expect(await getRequesterTicketForSpace(session, 'sp-1')).toBeNull();
  });

  it('resolves the ticket node and its sealed title', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-1:ticket-abc': member,
    } as never);
    vi.mocked(readSealedTicketInfo).mockResolvedValue({
      title: 'Login fails',
      requester: 'a@b.c',
    });
    expect(await getRequesterTicketForSpace(session, 'sp-1')).toEqual({
      nodeId: 'ticket-abc',
      title: 'Login fails',
    });
    expect(readSealedTicketInfo).toHaveBeenCalledWith(session, 'sp-1', 'ticket-abc');
  });

  it('returns an empty title when the sealed info is not yet readable', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-1:ticket-abc': member,
    } as never);
    vi.mocked(readSealedTicketInfo).mockResolvedValue(null);
    expect(await getRequesterTicketForSpace(session, 'sp-1')).toEqual({
      nodeId: 'ticket-abc',
      title: '',
    });
  });

  it('tolerates readSealedTicketInfo throwing (returns empty title)', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-1:ticket-abc': member,
    } as never);
    vi.mocked(readSealedTicketInfo).mockRejectedValue(new Error('network'));
    expect(await getRequesterTicketForSpace(session, 'sp-1')).toEqual({
      nodeId: 'ticket-abc',
      title: '',
    });
  });

  it('enforces one-per-space: returns the first ticket (stable-sorted) when several exist', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-1:ticket-bbb': member,
      'sp-1:ticket-aaa': member,
    } as never);
    vi.mocked(readSealedTicketInfo).mockResolvedValue({ title: 'first', requester: 'r' });
    const ticket = await getRequesterTicketForSpace(session, 'sp-1');
    expect(ticket?.nodeId).toBe('ticket-aaa');
    expect(readSealedTicketInfo).toHaveBeenCalledWith(session, 'sp-1', 'ticket-aaa');
  });

  it('ignores per-node sibling keys (:stream / :keyring), not just the bare node key', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-1:ticket-abc': member,
      'sp-1:ticket-abc:stream': member,
      'sp-1:ticket-abc:keyring': member,
    } as never);
    vi.mocked(readSealedTicketInfo).mockResolvedValue({ title: 'T', requester: 'r' });
    const ticket = await getRequesterTicketForSpace(session, 'sp-1');
    expect(ticket?.nodeId).toBe('ticket-abc');
    expect(readSealedTicketInfo).toHaveBeenCalledWith(session, 'sp-1', 'ticket-abc');
  });

  it('does not match a space whose id is a prefix of the target', async () => {
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-12:ticket-abc': member, // different space; prefix "sp-1" must not match across the colon
    } as never);
    expect(await getRequesterTicketForSpace(session, 'sp-1')).toBeNull();
  });
});
