import { describe, expect, it, vi } from 'vitest';

import { parseRoomChange } from './events.shared';

const frame = (o: unknown) => JSON.stringify(o);

describe('parseRoomChange', () => {
  it('routes private/E2EE collections via params.roomId', () => {
    for (const collection of ['chat', 'streamchat']) {
      expect(parseRoomChange(frame({ collection, hash: 'h', timestamp: 1, params: { spaceId: 'sp-a', roomId: 'sp-a-r1' } }))).toEqual({
        roomId: 'sp-a-r1',
        spaceId: 'sp-a',
        hash: 'h',
        ts: 1,
      });
    }
  });

  it('routes public streams (pubstream) via params.roomId', () => {
    expect(parseRoomChange(frame({ collection: 'pubstream', params: { spaceId: 'psp-a', roomId: 'psp-a-r1' } }))).toMatchObject({
      roomId: 'psp-a-r1',
      spaceId: 'psp-a',
    });
  });

  it('routes public channels (pubspace) via params.docId', () => {
    expect(parseRoomChange(frame({ collection: 'pubspace', params: { spaceId: 'psp-a', docId: 'psp-a-c1' } }))).toMatchObject({
      roomId: 'psp-a-c1',
      spaceId: 'psp-a',
    });
  });

  it('drops the pubspace _rooms registry write (not a room)', () => {
    expect(parseRoomChange(frame({ collection: 'pubspace', params: { spaceId: 'psp-a', docId: '_rooms' } }))).toBeNull();
  });

  it('drops a pubspace event with no docId', () => {
    expect(parseRoomChange(frame({ collection: 'pubspace', params: { spaceId: 'psp-a' } }))).toBeNull();
  });

  it('unwraps the Whistler { rawPayload } envelope (pubspace docId)', () => {
    const env = { rawPayload: { collection: 'pubspace', params: { spaceId: 'psp-a', docId: 'psp-a-c2' }, hash: 'h2', timestamp: 9 } };
    expect(parseRoomChange(frame(env))).toEqual({ roomId: 'psp-a-c2', spaceId: 'psp-a', hash: 'h2', ts: 9 });
  });

  it('forwards the write author identity when present (raw + rawPayload)', () => {
    const id = 'a'.repeat(32);
    expect(parseRoomChange(frame({ collection: 'chat', params: { spaceId: 'sp-a', roomId: 'sp-a-r1' }, identity: id }))).toMatchObject({
      roomId: 'sp-a-r1',
      identity: id,
    });
    const env = { rawPayload: { collection: 'chat', params: { spaceId: 'sp-a', roomId: 'sp-a-r2' }, identity: id } };
    expect(parseRoomChange(frame(env))).toMatchObject({ roomId: 'sp-a-r2', identity: id });
  });

  it('leaves identity undefined when the server omits it', () => {
    expect(parseRoomChange(frame({ collection: 'chat', params: { spaceId: 'sp-a', roomId: 'sp-a-r1' } }))?.identity).toBeUndefined();
  });

  it('returns null for a non-chat payload (no room/doc id) and for invalid JSON', () => {
    expect(parseRoomChange(frame({ collection: 'chat', params: { spaceId: 'sp-a' } }))).toBeNull();
    expect(parseRoomChange('not json')).toBeNull();
  });
});
