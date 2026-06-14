import { describe, expect, it } from 'vitest';

import { parseRoomChange } from './events.shared';

const frame = (o: unknown) => JSON.stringify(o);

describe('parseRoomChange', () => {
  it('routes streamchat (E2EE / space member) via params.roomId', () => {
    expect(
      parseRoomChange(frame({ collection: 'streamchat', hash: 'h', timestamp: 1, params: { spaceId: 'sp-a', roomId: 'sp-a-r1' } })),
    ).toEqual({ roomId: 'sp-a-r1', spaceId: 'sp-a', hash: 'h', ts: 1 });
  });

  it('routes streampub (public plaintext) via params.roomId', () => {
    expect(
      parseRoomChange(frame({ collection: 'streampub', hash: 'h2', timestamp: 2, params: { spaceId: 'sp-a', roomId: 'sp-a-pub1' } })),
    ).toMatchObject({ roomId: 'sp-a-pub1', spaceId: 'sp-a', hash: 'h2', ts: 2 });
  });

  it('routes streaminv (invite plaintext) via params.roomId', () => {
    expect(
      parseRoomChange(frame({ collection: 'streaminv', params: { spaceId: 'sp-a', roomId: 'sp-a-inv1' } })),
    ).toMatchObject({ roomId: 'sp-a-inv1', spaceId: 'sp-a' });
  });

  it('drops objindex events (no roomId — index-wide, left to focus-pull)', () => {
    expect(parseRoomChange(frame({ collection: 'objindex', params: { spaceId: 'sp-a' } }))).toBeNull();
  });

  it('forwards the write author identity when present (raw + rawPayload)', () => {
    const id = 'a'.repeat(32);
    expect(
      parseRoomChange(frame({ collection: 'streamchat', params: { spaceId: 'sp-a', roomId: 'sp-a-r1' }, identity: id })),
    ).toMatchObject({ roomId: 'sp-a-r1', identity: id });
    const env = { rawPayload: { collection: 'streamchat', params: { spaceId: 'sp-a', roomId: 'sp-a-r2' }, identity: id } };
    expect(parseRoomChange(frame(env))).toMatchObject({ roomId: 'sp-a-r2', identity: id });
  });

  it('leaves identity undefined when the server omits it', () => {
    expect(
      parseRoomChange(frame({ collection: 'streamchat', params: { spaceId: 'sp-a', roomId: 'sp-a-r1' } }))?.identity,
    ).toBeUndefined();
  });

  it('unwraps the Whistler { rawPayload } envelope', () => {
    const env = { rawPayload: { collection: 'streampub', params: { spaceId: 'sp-a', roomId: 'sp-a-pub2' }, hash: 'h2', timestamp: 9 } };
    expect(parseRoomChange(frame(env))).toEqual({ roomId: 'sp-a-pub2', spaceId: 'sp-a', hash: 'h2', ts: 9 });
  });

  it('returns null for a payload with no roomId and for invalid JSON', () => {
    expect(parseRoomChange(frame({ collection: 'streamchat', params: { spaceId: 'sp-a' } }))).toBeNull();
    expect(parseRoomChange('not json')).toBeNull();
  });
});
