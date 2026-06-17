import { describe, expect, it } from 'vitest';
import { requesterDisplay } from './request-display';

const req = (over: Record<string, unknown> = {}) =>
  ({
    reqId: 'r1',
    spaceId: 'sp-1',
    nodeType: 'ticket',
    title: 'T',
    requester: { userId: '0a876f7bdeadbeef', edPub: 'ed', kemPub: 'kem', kemSig: 'sig' },
    ...over,
  }) as unknown as Parameters<typeof requesterDisplay>[0];

describe('requesterDisplay', () => {
  it('prefers the app-supplied meta.requester label', () => {
    expect(requesterDisplay(req({ meta: { requester: 'alice@example.com' } }))).toEqual({
      who: 'alice@example.com',
      shortId: '0a876f7b…',
    });
  });

  it('falls back to the short id when no label is given', () => {
    expect(requesterDisplay(req()).who).toBe('0a876f7b…');
  });

  it('falls back to the short id when the label is blank or not a string', () => {
    expect(requesterDisplay(req({ meta: { requester: '   ' } })).who).toBe('0a876f7b…');
    expect(requesterDisplay(req({ meta: { requester: 42 } })).who).toBe('0a876f7b…');
  });

  it('trims a padded label', () => {
    expect(requesterDisplay(req({ meta: { requester: '  bob  ' } })).who).toBe('bob');
  });
});
