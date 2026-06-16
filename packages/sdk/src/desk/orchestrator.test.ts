import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the octospaces-sdk surface the orchestrator uses + the registry-write helpers, so
// these tests focus on the desk orchestration logic (isolation flags, E2EE keyring grants).
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createNodeInviteLink: vi.fn(async () => ({ link: 'https://x/join#tok', token: {} })),
  addNodeKeyringRecipient: vi.fn(async () => undefined),
  readProfile: vi.fn(async () => ({ kemPub: 'assignee-kem', pseudo: null, avatar: null, edPub: 'assignee-ed' })),
}));

vi.mock('./registry-write', () => ({
  createTicketNode: vi.fn(async () => undefined),
  createTicketNodeWithReqId: vi.fn(async () => undefined),
  patchTicketMeta: vi.fn(async () => undefined),
}));

import { createTicket, assignTicket, patchTicketStatus } from './orchestrator';
import { createNodeInviteLink, addNodeKeyringRecipient, readProfile } from '@drakkar.software/octospaces-sdk';
import { patchTicketMeta } from './registry-write';
import type { Session } from '../starfish/identity';

const session = { userId: 'owner', keys: {} } as unknown as Session;

describe('createTicket — isolation', () => {
  beforeEach(() => {
    vi.mocked(createNodeInviteLink).mockClear().mockResolvedValue({ link: 'l', token: {} } as never);
  });

  it('plaintext ticket: enc:false, ALWAYS isolated', async () => {
    await createTicket(session, 'sp-1', { title: 'T', requester: 'a@b.c', inviteLinkOrigin: 'https://x' });
    const args = vi.mocked(createNodeInviteLink).mock.calls[0]!;
    expect(args[4]).toEqual({ enc: false }); // node descriptor
    expect(args[7]).toEqual({ isolated: true }); // opts — never leaks the space index
  });

  it('E2EE ticket (memberTicket): enc:true + isolated:true → per-node keyring', async () => {
    await createTicket(session, 'sp-1', { title: 'T', requester: 'a@b.c', memberTicket: true, inviteLinkOrigin: 'https://x' });
    const args = vi.mocked(createNodeInviteLink).mock.calls[0]!;
    expect(args[4]).toEqual({ enc: true });
    expect(args[7]).toEqual({ isolated: true });
  });
});

describe('assignTicket — E2EE keyring grant', () => {
  beforeEach(() => {
    vi.mocked(patchTicketMeta).mockClear();
    vi.mocked(addNodeKeyringRecipient).mockClear();
    vi.mocked(readProfile).mockClear().mockResolvedValue({ kemPub: 'assignee-kem', pseudo: null, avatar: null, edPub: 'a' } as never);
  });

  it('plaintext ticket: only patches assigneeId, no keyring grant', async () => {
    await assignTicket(session, 'sp-1', 'ticket-1', 'agent-1');
    expect(patchTicketMeta).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1', { assigneeId: 'agent-1' });
    expect(addNodeKeyringRecipient).not.toHaveBeenCalled();
    expect(readProfile).not.toHaveBeenCalled();
  });

  it('E2EE ticket: adds the assignee KEM (from their profile) to the node keyring', async () => {
    await assignTicket(session, 'sp-1', 'ticket-1', 'agent-1', { enc: true });
    expect(patchTicketMeta).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1', { assigneeId: 'agent-1' });
    expect(readProfile).toHaveBeenCalledWith('agent-1');
    expect(addNodeKeyringRecipient).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1', {
      subKem: 'assignee-kem',
      userId: 'agent-1',
    });
  });

  it('E2EE unassign (null assignee): clears assignee, no keyring grant', async () => {
    await assignTicket(session, 'sp-1', 'ticket-1', null, { enc: true });
    expect(patchTicketMeta).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1', { assigneeId: null });
    expect(addNodeKeyringRecipient).not.toHaveBeenCalled();
  });

  it('E2EE: throws when the assignee has no published encryption key', async () => {
    vi.mocked(readProfile).mockResolvedValue({ kemPub: null, pseudo: null, avatar: null, edPub: null } as never);
    await expect(assignTicket(session, 'sp-1', 'ticket-1', 'agent-1', { enc: true })).rejects.toThrow(/no published/);
    expect(addNodeKeyringRecipient).not.toHaveBeenCalled();
  });
});

describe('patchTicketStatus', () => {
  beforeEach(() => vi.mocked(patchTicketMeta).mockClear());
  it('patches the status field', async () => {
    await patchTicketStatus(session, 'sp-1', 'ticket-1', 'solved');
    expect(patchTicketMeta).toHaveBeenCalledWith(session, 'sp-1', 'ticket-1', { status: 'solved' });
  });
});
