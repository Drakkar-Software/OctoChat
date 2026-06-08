import { beforeEach, describe, expect, it } from 'vitest';

// The pure reducers (resetSendingToQueued / filterPending) moved to the SDK and are
// covered by `outbox-reducers.test.ts` there; this file owns the app-side zustand store.
import { outboxStore, type OutboxMessage } from './outbox';

const entry = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: 'm1',
  roomId: 'sp-1-general',
  spaceId: 'sp-1',
  kind: 'channel',
  authorId: 'u1',
  text: 'hi',
  ts: 1,
  status: 'queued',
  attempts: 0,
  ...over,
});

describe('outboxStore actions', () => {
  beforeEach(() => outboxStore.setState({ userId: 'u1', items: [] }));

  it('enqueue appends', () => {
    outboxStore.getState().enqueue(entry({ id: 'a' }));
    outboxStore.getState().enqueue(entry({ id: 'b' }));
    expect(outboxStore.getState().items.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('claim wins once, blocks a concurrent second claim (no double-send)', () => {
    outboxStore.getState().enqueue(entry({ id: 'a' }));
    expect(outboxStore.getState().claim('a')).toBe(true);
    expect(outboxStore.getState().claim('a')).toBe(false);
    expect(outboxStore.getState().items[0].status).toBe('sending');
  });

  it('remove drops a sent entry', () => {
    outboxStore.getState().enqueue(entry({ id: 'a' }));
    outboxStore.getState().remove('a');
    expect(outboxStore.getState().items).toHaveLength(0);
  });

  it('markFailed keeps the entry, marks failed, bumps attempts', () => {
    outboxStore.getState().enqueue(entry({ id: 'a' }));
    outboxStore.getState().claim('a');
    outboxStore.getState().markFailed('a');
    const it = outboxStore.getState().items[0];
    expect(it.status).toBe('failed');
    expect(it.attempts).toBe(1);
  });

  it('retry re-queues a failed entry', () => {
    outboxStore.getState().enqueue(entry({ id: 'a', status: 'failed', attempts: 2 }));
    outboxStore.getState().retry('a');
    expect(outboxStore.getState().items[0].status).toBe('queued');
  });

  it('recordFailure keeps an entry queued until maxAttempts, then parks it failed', () => {
    outboxStore.getState().enqueue(entry({ id: 'a' }));
    outboxStore.getState().recordFailure('a', 3);
    expect(outboxStore.getState().items[0]).toMatchObject({ status: 'queued', attempts: 1 });
    outboxStore.getState().recordFailure('a', 3);
    expect(outboxStore.getState().items[0]).toMatchObject({ status: 'queued', attempts: 2 });
    outboxStore.getState().recordFailure('a', 3);
    expect(outboxStore.getState().items[0]).toMatchObject({ status: 'failed', attempts: 3 });
  });
});
