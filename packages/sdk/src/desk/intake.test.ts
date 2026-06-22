import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the octospaces-sdk surface intake.ts uses (keep the rest real so ../starfish/paths —
// which re-exports objInvLogPush from octospaces-sdk — still resolves a real path string).
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  scanResourceRequests: vi.fn(),
  acceptResourceRequest: vi.fn(),
  rejectResourceRequest: vi.fn(),
  getNodeStreamClient: vi.fn(),
}));
vi.mock('../starfish/registry', () => ({
  readSpaces: vi.fn(async () => ({ declinedRequests: {} })),
  setRequestDeclined: vi.fn(async () => undefined),
}));
vi.mock('./intake-config', () => ({ readIntakeConfig: vi.fn() }));
vi.mock('./orchestrator', () => ({
  makeTicketCreateHandler: vi.fn(() => vi.fn()),
  makeRoomCreateHandler: vi.fn(() => vi.fn()),
}));
vi.mock('../ai/engine-port', () => ({ isLlmConfigured: vi.fn(() => false), runLlm: vi.fn() }));

import {
  reconcileTicketRequests,
  composeIntakeReply,
  declineTicketRequest,
  listPendingTicketRequests,
  acceptTicketRequest,
  DEFAULT_INTAKE_REPLY,
} from './intake';
import {
  scanResourceRequests,
  acceptResourceRequest,
  rejectResourceRequest,
  getNodeStreamClient,
} from '@drakkar.software/octospaces-sdk';
import { readSpaces, setRequestDeclined } from '../starfish/registry';
import { readIntakeConfig, type IntakeConfig } from './intake-config';
import { isLlmConfigured, runLlm } from '../ai/engine-port';
import type { Session } from '../starfish/identity';

const session = { userId: 'owner', keys: {} } as unknown as Session;
const pendingReq = (id: string) =>
  ({ req: { reqId: id, spaceId: 'sp-1', title: 'T', message: 'hello', nodeType: 'ticket', requester: { userId: 'u' } }, senderEdPub: 'ed' }) as never;
const replyText = (call: unknown[]): string => (call[1] as { e: { text: string } }).e.text;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLlmConfigured).mockReturnValue(false);
  vi.mocked(acceptResourceRequest).mockResolvedValue({ spaceId: 'sp-1', nodeId: 'ticket-1' } as never);
  vi.mocked(readSpaces).mockResolvedValue({ declinedRequests: {} } as never);
});

describe('reconcileTicketRequests', () => {
  it('manual: scans, but accepts nothing (left for the Requests UI)', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'manual', replyKind: 'fixed', replyText: '' });
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1')]);
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(false);
    expect(acceptResourceRequest).not.toHaveBeenCalled();
  });

  it('empty inbox: accepts nothing and never reads a config', async () => {
    vi.mocked(scanResourceRequests).mockResolvedValue([]);
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(false);
    expect(readIntakeConfig).not.toHaveBeenCalled();
    expect(acceptResourceRequest).not.toHaveBeenCalled();
  });

  it('auto-accept: accepts each request, posts NO reply', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-accept', replyKind: 'fixed', replyText: 'x' });
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1'), pendingReq('r2')]);
    const append = vi.fn();
    vi.mocked(getNodeStreamClient).mockReturnValue({ append } as never);
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(true);
    expect(acceptResourceRequest).toHaveBeenCalledTimes(2);
    expect(append).not.toHaveBeenCalled();
  });

  it('auto-reply (fixed): accepts, then posts the fixed message into objinvlog', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-reply', replyKind: 'fixed', replyText: 'thanks!' });
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1')]);
    const append = vi.fn();
    vi.mocked(getNodeStreamClient).mockReturnValue({ append } as never);
    await reconcileTicketRequests(session, new Set(['sp-1']));
    expect(append).toHaveBeenCalledTimes(1);
    const call = append.mock.calls[0]!;
    expect(String(call[0])).toContain('sp-1'); // objinvlog path bound to the real space + node
    expect(String(call[0])).toContain('ticket-1');
    expect(replyText(call)).toBe('thanks!');
    expect(runLlm).not.toHaveBeenCalled();
  });

  it('auto-reply (ai, engine wired): posts the AI output', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-reply', replyKind: 'ai', replyText: 'fallback' });
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1')]);
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(runLlm).mockResolvedValue('  AI hello  ');
    const append = vi.fn();
    vi.mocked(getNodeStreamClient).mockReturnValue({ append } as never);
    await reconcileTicketRequests(session, new Set(['sp-1']));
    expect(runLlm).toHaveBeenCalledTimes(1);
    expect(replyText(append.mock.calls[0]!)).toBe('AI hello');
  });

  it('best-effort: a failing accept does not block the rest', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-accept', replyKind: 'fixed', replyText: '' });
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1'), pendingReq('r2')]);
    vi.mocked(acceptResourceRequest)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ spaceId: 'sp-1', nodeId: 'ticket-2' } as never);
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(true);
    expect(acceptResourceRequest).toHaveBeenCalledTimes(2);
  });

  it('reads each space config at most once across multiple requests (cache)', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-accept', replyKind: 'fixed', replyText: '' });
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1'), pendingReq('r2'), pendingReq('r3')]);
    await reconcileTicketRequests(session, new Set(['sp-1']));
    expect(readIntakeConfig).toHaveBeenCalledTimes(1); // all three target sp-1
    expect(acceptResourceRequest).toHaveBeenCalledTimes(3);
  });

  it('dispatches each request by its OWN space config (auto vs manual)', async () => {
    const reqFor = (id: string, sp: string) =>
      ({ req: { reqId: id, spaceId: sp, title: 'T', message: 'm', nodeType: 'ticket', requester: { userId: 'u' } }, senderEdPub: 'ed' }) as never;
    vi.mocked(scanResourceRequests).mockResolvedValue([reqFor('r1', 'sp-1'), reqFor('r2', 'sp-2')]);
    vi.mocked(readIntakeConfig).mockImplementation(async (_s, spaceId) =>
      spaceId === 'sp-1'
        ? { mode: 'auto-accept', replyKind: 'fixed', replyText: '' }
        : { mode: 'manual', replyKind: 'fixed', replyText: '' },
    );
    expect(await reconcileTicketRequests(session, new Set(['sp-1', 'sp-2']))).toBe(true);
    expect(acceptResourceRequest).toHaveBeenCalledTimes(1); // sp-1 auto; sp-2 manual is skipped
  });

  it('skips a space whose config read fails (not ours / offline) without throwing', async () => {
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1')]);
    vi.mocked(readIntakeConfig).mockRejectedValue(new Error('offline'));
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(false);
    expect(acceptResourceRequest).not.toHaveBeenCalled();
  });
});

describe('composeIntakeReply', () => {
  const req = { reqId: 'r', spaceId: 'sp', title: 'T', message: 'm', nodeType: 'ticket', requester: { userId: 'u' } } as never;
  const cfg = (over: Partial<IntakeConfig>): IntakeConfig => ({ mode: 'auto-reply', replyKind: 'fixed', replyText: '', ...over });

  it('fixed: returns the configured text', async () => {
    expect(await composeIntakeReply(cfg({ replyKind: 'fixed', replyText: 'set' }), req)).toBe('set');
  });
  it('fixed blank: returns the default reply', async () => {
    expect(await composeIntakeReply(cfg({ replyKind: 'fixed', replyText: '' }), req)).toBe(DEFAULT_INTAKE_REPLY);
  });
  it('ai without an engine: falls back to fixed text, never calls runLlm', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    expect(await composeIntakeReply(cfg({ replyKind: 'ai', replyText: 'fb' }), req)).toBe('fb');
    expect(runLlm).not.toHaveBeenCalled();
  });
  it('ai with engine failure: falls back to fixed text', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(runLlm).mockRejectedValue(new Error('no model'));
    expect(await composeIntakeReply(cfg({ replyKind: 'ai', replyText: 'fb' }), req)).toBe('fb');
  });
});

describe('listPendingTicketRequests / declineTicketRequest', () => {
  it('list delegates to scanResourceRequests for the one space', async () => {
    vi.mocked(scanResourceRequests).mockResolvedValue([]);
    await listPendingTicketRequests(session, 'sp-9');
    expect(scanResourceRequests).toHaveBeenCalledWith(session, new Set(['sp-9']));
  });

  it('list filters out previously-declined reqIds so they never reappear after refresh', async () => {
    vi.mocked(readSpaces).mockResolvedValue({ declinedRequests: { r2: true } } as never);
    vi.mocked(scanResourceRequests).mockResolvedValue([pendingReq('r1'), pendingReq('r2')]);
    const result = await listPendingTicketRequests(session, 'sp-9');
    expect(result).toHaveLength(1);
    expect(result[0]!.req.reqId).toBe('r1');
  });

  it('decline seals rejection to requester AND persists the reqId so it stays gone on refresh', async () => {
    const p = pendingReq('r');
    await declineTicketRequest(session, p, 'spam');
    expect(rejectResourceRequest).toHaveBeenCalledWith(session, p, 'spam');
    expect(setRequestDeclined).toHaveBeenCalledWith(session.spacesRegistryClient, session.userId, 'r');
  });

  it('accept delegates to acceptResourceRequest with the ticket create handler', async () => {
    const p = pendingReq('r');
    await acceptTicketRequest(session, p);
    expect(acceptResourceRequest).toHaveBeenCalledWith(session, p, expect.objectContaining({ create: expect.any(Function) }));
  });

  it('acceptNodeRequest with nodeType:room routes to makeRoomCreateHandler', async () => {
    const { makeRoomCreateHandler } = await import('./orchestrator');
    const p = { req: { reqId: 'r', spaceId: 'sp-1', title: 'T', message: '', nodeType: 'room', requester: { userId: 'u' } }, senderEdPub: 'ed' } as never;
    await (await import('./intake')).acceptNodeRequest(session, p);
    expect(makeRoomCreateHandler).toHaveBeenCalled();
  });

  it('acceptNodeRequest with empty nodeType throws instead of silently creating a ticket', async () => {
    const p = { req: { reqId: 'r', spaceId: 'sp-1', title: 'T', message: '', nodeType: '', requester: { userId: 'u' } }, senderEdPub: 'ed' } as never;
    await expect((await import('./intake')).acceptNodeRequest(session, p)).rejects.toThrow('Unknown request nodeType');
  });
});

describe('reconcileTicketRequests — nodeType routing', () => {
  const roomReq = (id: string) =>
    ({ req: { reqId: id, spaceId: 'sp-1', title: 'T', message: '', nodeType: 'room', requester: { userId: 'u' } }, senderEdPub: 'ed' }) as never;
  const unknownReq = (id: string) =>
    ({ req: { reqId: id, spaceId: 'sp-1', title: 'T', message: '', nodeType: 'survey', requester: { userId: 'u' } }, senderEdPub: 'ed' }) as never;
  const missingTypeReq = (id: string) =>
    ({ req: { reqId: id, spaceId: 'sp-1', title: 'T', message: '', nodeType: '', requester: { userId: 'u' } }, senderEdPub: 'ed' }) as never;

  beforeEach(() => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-accept', replyKind: 'fixed', replyText: '' });
  });

  it('nodeType:room routes to makeRoomCreateHandler', async () => {
    const { makeRoomCreateHandler } = await import('./orchestrator');
    vi.mocked(scanResourceRequests).mockResolvedValue([roomReq('r1')]);
    await reconcileTicketRequests(session, new Set(['sp-1']));
    expect(makeRoomCreateHandler).toHaveBeenCalled();
  });

  it('unknown nodeType skips that request (best-effort) without aborting others in the batch', async () => {
    vi.mocked(scanResourceRequests).mockResolvedValue([unknownReq('r1'), pendingReq('r2')]);
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(true);
    // r2 (ticket) is accepted; r1 (unknown) is skipped
    expect(acceptResourceRequest).toHaveBeenCalledTimes(1);
  });

  it('empty nodeType skips that request (best-effort) without aborting others', async () => {
    vi.mocked(scanResourceRequests).mockResolvedValue([missingTypeReq('r1'), pendingReq('r2')]);
    expect(await reconcileTicketRequests(session, new Set(['sp-1']))).toBe(true);
    expect(acceptResourceRequest).toHaveBeenCalledTimes(1);
  });

  it('auto-reply is NOT sent for nodeType:room requests', async () => {
    vi.mocked(readIntakeConfig).mockResolvedValue({ mode: 'auto-reply', replyKind: 'fixed', replyText: 'hi' });
    vi.mocked(scanResourceRequests).mockResolvedValue([roomReq('r1')]);
    const append = vi.fn();
    vi.mocked(getNodeStreamClient).mockReturnValue({ append } as never);
    await reconcileTicketRequests(session, new Set(['sp-1']));
    expect(acceptResourceRequest).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
  });
});
