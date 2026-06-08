import { describe, expect, it } from 'vitest';

import { filterPending, resetSendingToQueued } from './outbox-reducers';
import type { OutboxMessage } from './outbox-types';

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

describe('resetSendingToQueued', () => {
  it('flips stuck `sending` entries back to `queued`, leaves others', () => {
    const out = resetSendingToQueued([
      entry({ id: 'a', status: 'sending' }),
      entry({ id: 'b', status: 'failed' }),
      entry({ id: 'c', status: 'queued' }),
    ]);
    expect(out.map((e) => e.status)).toEqual(['queued', 'failed', 'queued']);
  });
});

describe('filterPending', () => {
  const items = [
    entry({ id: 'top', parentId: undefined }),
    entry({ id: 'reply', parentId: 'p1' }),
    entry({ id: 'other-room', roomId: 'sp-2-x' }),
  ];
  it('top-level surface excludes thread replies and other rooms', () => {
    expect(filterPending(items, 'sp-1-general').map((e) => e.id)).toEqual(['top']);
  });
  it('thread surface matches only its parentId', () => {
    expect(filterPending(items, 'sp-1-general', 'p1').map((e) => e.id)).toEqual(['reply']);
  });
});
