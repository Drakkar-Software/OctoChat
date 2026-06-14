import { describe, expect, it, vi } from 'vitest';

// The config module reads expo constants — mock the whole chain so paths.ts can
// import from it in Node without a runtime error.
vi.mock('./config', () => ({
  getSyncBase: () => 'https://sync.example',
  getSyncPrefix: () => '',
}));
vi.mock('@drakkar.software/octospaces-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/octospaces-sdk')>();
  return {
    ...actual,
    getSyncBase: () => 'https://sync.example',
    getSyncNamespace: () => 'default',
    getSyncPrefix: () => '',
  };
});
vi.mock('../config/config', () => ({
  getSyncBase: () => 'https://sync.example',
  getSyncPrefix: () => '',
}));

import {
  streamRoomPull,
  streamRoomPush,
  streamPubRoomPull,
  streamPubRoomPush,
  streamInvRoomPull,
  streamInvRoomPush,
  spaceRegistryPull,
  spaceRegistryPush,
} from './paths';

// Room IDs always encode their space via `sp-<spaceId>-<local>` convention.
const ROOM = 'sp-abc-general';
const SPACE = 'sp-abc';

describe('per-node stream path routing', () => {
  it('streamchat (space/E2EE) uses spaces/{spaceId}/streams/{roomId}', () => {
    const pull = streamRoomPull(ROOM);
    const push = streamRoomPush(ROOM);
    expect(pull).toContain(`spaces/${SPACE}/streams/${ROOM}`);
    expect(push).toContain(`spaces/${SPACE}/streams/${ROOM}`);
    // pull and push must differ (different verbs / path prefixes)
    expect(pull).not.toBe(push);
  });

  it('streampub (public) uses spaces/{spaceId}/streams/pub/{roomId}', () => {
    const pull = streamPubRoomPull(ROOM);
    const push = streamPubRoomPush(ROOM);
    expect(pull).toContain(`spaces/${SPACE}/streams/pub/${ROOM}`);
    expect(push).toContain(`spaces/${SPACE}/streams/pub/${ROOM}`);
    expect(pull).not.toBe(push);
  });

  it('streaminv (invite-plaintext) uses spaces/{spaceId}/streams/n/{roomId}/log', () => {
    const pull = streamInvRoomPull(ROOM);
    const push = streamInvRoomPush(ROOM);
    expect(pull).toContain(`spaces/${SPACE}/streams/n/${ROOM}/log`);
    expect(push).toContain(`spaces/${SPACE}/streams/n/${ROOM}/log`);
    expect(pull).not.toBe(push);
  });

  it('all three stream variants produce distinct paths for the same room', () => {
    const paths = [
      streamRoomPull(ROOM),
      streamPubRoomPull(ROOM),
      streamInvRoomPull(ROOM),
    ];
    const unique = new Set(paths);
    expect(unique.size).toBe(3);
  });

  it('pub and inv segments are reserved — never collide with a normal roomId', () => {
    // Room ids are `sp-…` prefixed; `pub` and `n` are bare bare path segments.
    expect(streamPubRoomPull(ROOM)).toContain('/pub/');
    expect(streamInvRoomPull(ROOM)).toContain('/n/');
    expect(streamRoomPull(ROOM)).not.toContain('/pub/');
    expect(streamRoomPull(ROOM)).not.toContain('/n/');
  });
});

describe('space access registry path', () => {
  it('uses spaces/{spaceId}/_access (not _rooms)', () => {
    expect(spaceRegistryPull(SPACE)).toContain(`spaces/${SPACE}/_access`);
    expect(spaceRegistryPush(SPACE)).toContain(`spaces/${SPACE}/_access`);
  });

  it('pull and push differ', () => {
    expect(spaceRegistryPull(SPACE)).not.toBe(spaceRegistryPush(SPACE));
  });
});
