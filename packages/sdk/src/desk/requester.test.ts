import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  localSpaceAccessEntries: vi.fn(() => ({})),
  submitResourceRequest: vi.fn(() => Promise.resolve({ reqId: 'req-test-1' })),
  scanResourceGrants: vi.fn(() => Promise.resolve([])),
  scanResourceRejects: vi.fn(() => Promise.resolve([])),
  acceptResourceGrant: vi.fn(() => Promise.resolve()),
  addJoinedSpace: vi.fn(() => Promise.resolve()),
  buildSpace: vi.fn((id: string, name: string) => ({ id, name })),
}));

vi.mock('../starfish/registry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readSpaces: vi.fn(() => Promise.resolve({ outgoingRequests: {} })),
  recordOutgoingRequest: vi.fn(() => Promise.resolve()),
  setOutgoingRequestRefused: vi.fn(() => Promise.resolve()),
}));

vi.mock('../starfish/dm-link', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decodeRequestLink: vi.fn(() => ({
    identity: { edPub: 'owner-ed-pub', kemPub: 'owner-kem-pub', ownerId: 'owner-id', pseudo: 'Owner' },
    spaceId: 'sp-1',
  })),
}));

vi.mock('./ticket-info', () => ({
  readSealedTicketInfo: vi.fn(),
}));

import {
  getRequesterTicketForSpace,
  claimGrantedNodes,
  claimRejectedRequests,
  getOutgoingRequestsForSpace,
  submitTicketRequest,
  submitRoomRequest,
} from './requester';
import {
  localSpaceAccessEntries,
  submitResourceRequest,
  scanResourceGrants,
  scanResourceRejects,
  acceptResourceGrant,
  addJoinedSpace,
  buildSpace,
} from '@drakkar.software/octospaces-sdk';
import { readSpaces, recordOutgoingRequest, setOutgoingRequestRefused } from '../starfish/registry';
import { readSealedTicketInfo } from './ticket-info';
import type { Session } from '../starfish/identity';
import type { ResourceGrant, ResourceReject } from '@drakkar.software/octospaces-sdk';

const session = { userId: 'u1', spacesRegistryClient: {} } as unknown as Session;
const member = { kind: 'member', cap: 'c' } as const;

const makeGrant = (nodeId: string, bundle: object | string): ResourceGrant =>
  ({
    reqId: `req-${nodeId}`,
    nodeId,
    spaceId: 'sp-1',
    bundle: typeof bundle === 'string' ? bundle : JSON.stringify(bundle),
  }) as unknown as ResourceGrant;

beforeEach(() => {
  vi.mocked(localSpaceAccessEntries).mockReset().mockReturnValue({});
  vi.mocked(readSealedTicketInfo).mockReset().mockResolvedValue(null);
  vi.mocked(submitResourceRequest).mockReset().mockResolvedValue({ reqId: 'req-test-1' });
  vi.mocked(scanResourceGrants).mockReset().mockResolvedValue([]);
  vi.mocked(scanResourceRejects).mockReset().mockResolvedValue([]);
  vi.mocked(acceptResourceGrant).mockReset().mockResolvedValue(undefined);
  vi.mocked(addJoinedSpace).mockReset().mockResolvedValue(undefined);
  vi.mocked(buildSpace).mockReset().mockImplementation((id, name) => ({ id, name }) as never);
  vi.mocked(readSpaces).mockReset().mockResolvedValue({ outgoingRequests: {} } as never);
  vi.mocked(recordOutgoingRequest).mockReset().mockResolvedValue(undefined);
  vi.mocked(setOutgoingRequestRefused).mockReset().mockResolvedValue(undefined);
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

describe('claimGrantedNodes', () => {
  it('returns empty array when inbox has no grants', async () => {
    vi.mocked(scanResourceGrants).mockResolvedValue([]);
    expect(await claimGrantedNodes(session)).toEqual([]);
    expect(acceptResourceGrant).not.toHaveBeenCalled();
  });

  it('claims a grant and injects the synthetic Space using nodeName from bundle', async () => {
    const grant = makeGrant('shared-abc', { nodeName: 'Design room' });
    vi.mocked(scanResourceGrants).mockResolvedValue([grant]);
    const result = await claimGrantedNodes(session);
    expect(acceptResourceGrant).toHaveBeenCalledWith(session, grant);
    expect(buildSpace).toHaveBeenCalledWith('shared-abc', 'Design room');
    expect(addJoinedSpace).toHaveBeenCalledTimes(1);
    expect(result).toEqual([grant]);
  });

  it('falls back to nodeId when bundle JSON is malformed — grant still claimed', async () => {
    const grant = makeGrant('shared-xyz', 'not-json{{{{');
    vi.mocked(scanResourceGrants).mockResolvedValue([grant]);
    const result = await claimGrantedNodes(session);
    // acceptResourceGrant still called (caps stored)
    expect(acceptResourceGrant).toHaveBeenCalledWith(session, grant);
    // buildSpace falls back to nodeId
    expect(buildSpace).toHaveBeenCalledWith('shared-xyz', 'shared-xyz');
    expect(addJoinedSpace).toHaveBeenCalledTimes(1);
    expect(result).toEqual([grant]);
  });

  it('falls back to nodeId when nodeName in bundle is not a string', async () => {
    const grant = makeGrant('shared-num', { nodeName: 42 });
    vi.mocked(scanResourceGrants).mockResolvedValue([grant]);
    await claimGrantedNodes(session);
    expect(buildSpace).toHaveBeenCalledWith('shared-num', 'shared-num');
  });

  it('falls back to nodeId when nodeName in bundle is absent', async () => {
    const grant = makeGrant('shared-empty', {});
    vi.mocked(scanResourceGrants).mockResolvedValue([grant]);
    await claimGrantedNodes(session);
    expect(buildSpace).toHaveBeenCalledWith('shared-empty', 'shared-empty');
  });

  it('skips a corrupt grant (acceptResourceGrant throws) without blocking others', async () => {
    const bad = makeGrant('shared-bad', { nodeName: 'bad' });
    const good = makeGrant('shared-good', { nodeName: 'good' });
    vi.mocked(scanResourceGrants).mockResolvedValue([bad, good]);
    vi.mocked(acceptResourceGrant)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const result = await claimGrantedNodes(session);
    expect(acceptResourceGrant).toHaveBeenCalledTimes(2);
    expect(result).toEqual([good]);
  });

  it('passes seenReqIds to scanResourceGrants for dedup', async () => {
    const seen = new Set(['req-shared-old']);
    await claimGrantedNodes(session, { seenReqIds: seen });
    expect(scanResourceGrants).toHaveBeenCalledWith(session, { seenReqIds: seen });
  });

  it('addJoinedSpace failure does not prevent the grant from being counted as claimed', async () => {
    const grant = makeGrant('shared-offline', { nodeName: 'Offline room' });
    vi.mocked(scanResourceGrants).mockResolvedValue([grant]);
    vi.mocked(addJoinedSpace).mockRejectedValue(new Error('offline'));
    const result = await claimGrantedNodes(session);
    // Grant is still returned (caps stored, synthetic space will re-hydrate later)
    expect(result).toEqual([grant]);
  });
});

describe('submitTicketRequest / submitRoomRequest → recordOutgoingRequest', () => {
  it('records a pending outgoing request after filing a ticket', async () => {
    vi.mocked(submitResourceRequest).mockResolvedValue({ reqId: 'req-ticket-1' });
    await submitTicketRequest(session, 'https://example.com/request?s=sp-1#token', {
      title: 'Login fails',
      requester: 'alice',
    });
    expect(recordOutgoingRequest).toHaveBeenCalledWith(
      session.spacesRegistryClient,
      session.userId,
      'req-ticket-1',
      expect.objectContaining({ spaceId: 'sp-1', nodeType: 'ticket', title: 'Login fails' }),
    );
  });

  it('records a pending outgoing request after filing a room request', async () => {
    vi.mocked(submitResourceRequest).mockResolvedValue({ reqId: 'req-room-1' });
    await submitRoomRequest(session, 'https://example.com/request?s=sp-1#token', {
      title: 'Design room',
      requester: 'bob',
    });
    expect(recordOutgoingRequest).toHaveBeenCalledWith(
      session.spacesRegistryClient,
      session.userId,
      'req-room-1',
      expect.objectContaining({ spaceId: 'sp-1', nodeType: 'room', title: 'Design room' }),
    );
  });
});

describe('claimRejectedRequests', () => {
  const makeReject = (reqId: string, reason?: string): ResourceReject => ({
    v: 1,
    kind: 'reject',
    reqId,
    ...(reason ? { reason } : {}),
  });

  it('returns empty array when inbox has no rejects', async () => {
    vi.mocked(scanResourceRejects).mockResolvedValue([]);
    expect(await claimRejectedRequests(session)).toEqual([]);
    expect(setOutgoingRequestRefused).not.toHaveBeenCalled();
  });

  it('marks matching outgoing request as refused and returns it', async () => {
    const reject = makeReject('req-1', 'Out of scope');
    vi.mocked(scanResourceRejects).mockResolvedValue([reject]);
    const result = await claimRejectedRequests(session);
    expect(setOutgoingRequestRefused).toHaveBeenCalledWith(
      session.spacesRegistryClient,
      session.userId,
      'req-1',
    );
    expect(result).toEqual([reject]);
  });

  it('skips a corrupt reject (setOutgoingRequestRefused throws) without blocking others', async () => {
    const bad = makeReject('req-bad');
    const good = makeReject('req-good');
    vi.mocked(scanResourceRejects).mockResolvedValue([bad, good]);
    vi.mocked(setOutgoingRequestRefused)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const result = await claimRejectedRequests(session);
    expect(setOutgoingRequestRefused).toHaveBeenCalledTimes(2);
    expect(result).toEqual([good]);
  });

  it('passes seenReqIds to scanResourceRejects for dedup', async () => {
    const seen = new Set(['req-old']);
    await claimRejectedRequests(session, { seenReqIds: seen });
    expect(scanResourceRejects).toHaveBeenCalledWith(session, { seenReqIds: seen });
  });
});

describe('getOutgoingRequestsForSpace', () => {
  it('returns empty array when no outgoing requests exist', async () => {
    vi.mocked(readSpaces).mockResolvedValue({ outgoingRequests: {} } as never);
    expect(await getOutgoingRequestsForSpace(session, 'sp-1')).toEqual([]);
  });

  it('returns only requests for the given space, newest-first', async () => {
    vi.mocked(readSpaces).mockResolvedValue({
      outgoingRequests: {
        'req-old': { spaceId: 'sp-1', nodeType: 'ticket', title: 'Old', ts: 1000, status: 'pending' },
        'req-new': { spaceId: 'sp-1', nodeType: 'ticket', title: 'New', ts: 2000, status: 'pending' },
        'req-other': { spaceId: 'sp-2', nodeType: 'room', title: 'Other', ts: 9000, status: 'refused' },
      },
    } as never);
    const result = await getOutgoingRequestsForSpace(session, 'sp-1');
    expect(result).toHaveLength(2);
    expect(result[0].reqId).toBe('req-new');
    expect(result[1].reqId).toBe('req-old');
    expect(result.every((r) => r.spaceId === 'sp-1')).toBe(true);
  });

  it('surfaces a refused status so callers can detect the declined state', async () => {
    vi.mocked(readSpaces).mockResolvedValue({
      outgoingRequests: {
        'req-declined': { spaceId: 'sp-1', nodeType: 'ticket', title: 'Bug', ts: 500, status: 'refused' },
      },
    } as never);
    const [entry] = await getOutgoingRequestsForSpace(session, 'sp-1');
    expect(entry.status).toBe('refused');
    expect(entry.reqId).toBe('req-declined');
  });
});
