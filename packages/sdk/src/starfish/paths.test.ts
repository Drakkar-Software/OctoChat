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
  spaceAccessPull,
  spaceAccessPush,
} from './paths';

// Room IDs always encode their space via `sp-<spaceId>-<local>` convention.
const ROOM = 'sp-abc-general';
const SPACE = 'sp-abc';

describe('per-node stream path routing', () => {
  it('objlog (space/E2EE) uses spaces/{spaceId}/objects/logs/{roomId}', () => {
    const pull = streamRoomPull(ROOM);
    const push = streamRoomPush(ROOM);
    expect(pull).toContain(`spaces/${SPACE}/objects/logs/${ROOM}`);
    expect(push).toContain(`spaces/${SPACE}/objects/logs/${ROOM}`);
    // pull and push must differ (different verbs / path prefixes)
    expect(pull).not.toBe(push);
  });

  it('objpublog (public) uses spaces/{spaceId}/objects/pub/{roomId}/log', () => {
    const pull = streamPubRoomPull(ROOM);
    const push = streamPubRoomPush(ROOM);
    expect(pull).toContain(`spaces/${SPACE}/objects/pub/${ROOM}/log`);
    expect(push).toContain(`spaces/${SPACE}/objects/pub/${ROOM}/log`);
    expect(pull).not.toBe(push);
  });

  it('objinvlog (invite-plaintext) uses spaces/{spaceId}/objects/n/{roomId}/log', () => {
    const pull = streamInvRoomPull(ROOM);
    const push = streamInvRoomPush(ROOM);
    expect(pull).toContain(`spaces/${SPACE}/objects/n/${ROOM}/log`);
    expect(push).toContain(`spaces/${SPACE}/objects/n/${ROOM}/log`);
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

  it('pub and n segments are reserved — never collide with a normal roomId', () => {
    // objpublog path contains /pub/ and ends in /log
    expect(streamPubRoomPull(ROOM)).toContain('/pub/');
    // objinvlog path contains /n/
    expect(streamInvRoomPull(ROOM)).toContain('/n/');
    // objlog path has neither
    expect(streamRoomPull(ROOM)).not.toContain('/pub/');
    expect(streamRoomPull(ROOM)).not.toContain('/n/');
  });
});

describe('space access registry path', () => {
  it('uses spaces/{spaceId}/_access (not _rooms)', () => {
    expect(spaceAccessPull(SPACE)).toContain(`spaces/${SPACE}/_access`);
    expect(spaceAccessPush(SPACE)).toContain(`spaces/${SPACE}/_access`);
  });

  it('pull and push differ', () => {
    expect(spaceAccessPull(SPACE)).not.toBe(spaceAccessPush(SPACE));
  });
});
