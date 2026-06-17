/**
 * Regression tests for the ticket-room routing fix. A ticket is an `access:'invite'` node
 * whose id is `ticket-<hex>` — it carries NO embedded space and lives outside the rooms
 * registry. The bug: the space was re-derived from the room id (wrong for tickets) and the
 * invite log was addressed via `streamInvRoom*(roomId)` (which re-derives the space again).
 */
import { describe, expect, it } from 'vitest';
import { streamInvRoomPull } from '@drakkar.software/octochat-sdk';
import { resolveRoomLogPaths, resolveRoomSpaceId, resolveRoomAccess } from './room-route';

describe('resolveRoomLogPaths', () => {
  it('invite: addresses objinvlog with the EXPLICIT space id (not derived from the room id)', () => {
    const { pull, push } = resolveRoomLogPaths('invite', 'sp-real99', 'ticket-deadbeef');
    // The real space + node id appear in the path…
    expect(pull).toContain('sp-real99');
    expect(pull).toContain('ticket-deadbeef');
    expect(push).toContain('sp-real99');
    // …and it is the per-node objinvlog location (spaces/<space>/objects/n/<node>/…).
    expect(pull).toContain('objects/n/ticket-deadbeef');
  });

  it('REGRESSION: streamInvRoom*(ticketId) would derive the WRONG space — proves why we pass spaceId', () => {
    // spaceIdFromRoomId('ticket-deadbeef') = 'ticket-deadbeef' (first two '-' segments), so the
    // legacy helper lands on spaces/ticket-deadbeef/… — never the real space.
    const wrong = streamInvRoomPull('ticket-deadbeef');
    expect(wrong).not.toContain('sp-real99');
    expect(wrong).toContain('ticket-deadbeef'); // ← used as the SPACE segment, the bug
    // The fixed path is bound to the real space instead.
    expect(resolveRoomLogPaths('invite', 'sp-real99', 'ticket-deadbeef').pull).toContain('sp-real99');
  });

  it('invite path is independent of enc (E2EE tickets seal into the SAME objinvlog log)', () => {
    // resolveRoomLogPaths takes no enc — both plaintext and E2EE invite rooms route to objinvlog.
    const a = resolveRoomLogPaths('invite', 'sp-1', 'ticket-x');
    const b = resolveRoomLogPaths('invite', 'sp-1', 'ticket-x');
    expect(a).toEqual(b);
  });

  it('public: routes to the public stream; default: routes to the space-tier stream', () => {
    const pub = resolveRoomLogPaths('public', 'sp-1', 'sp-1-general');
    const space = resolveRoomLogPaths(undefined, 'sp-1', 'sp-1-general');
    // The three tiers are distinct paths.
    expect(pub.pull).not.toEqual(space.pull);
    expect(resolveRoomLogPaths('invite', 'sp-1', 'sp-1-general').pull).not.toEqual(space.pull);
  });
});

describe('resolveRoomSpaceId', () => {
  it('uses the spaceId param when present (the ticket-list case)', () => {
    expect(resolveRoomSpaceId({ spaceId: 'sp-real99' }, 'ticket-deadbeef')).toBe('sp-real99');
  });

  it('derives the space from a normal sp-<rand>-<name> room id when no param', () => {
    expect(resolveRoomSpaceId({}, 'sp-abc-general')).toBe('sp-abc');
  });

  it('a bare ticket id without a param derives a WRONG space (documents the param requirement)', () => {
    // No embedded space → derivation returns the ticket id itself; the param MUST be supplied.
    expect(resolveRoomSpaceId({}, 'ticket-deadbeef')).toBe('ticket-deadbeef');
  });
});

describe('resolveRoomAccess', () => {
  it('ticket (no registry row): falls back to the access/enc params', () => {
    expect(resolveRoomAccess({ access: 'invite', enc: '0' }, null)).toEqual({ access: 'invite', enc: false });
    expect(resolveRoomAccess({ access: 'invite', enc: '1' }, null)).toEqual({ access: 'invite', enc: true });
  });

  it('registry row wins over the params (normal room)', () => {
    expect(resolveRoomAccess({ access: 'invite', enc: '0' }, { access: 'space', enc: true })).toEqual({
      access: 'space',
      enc: true,
    });
  });

  it('enc param: "1"→true, "0"→false, absent→undefined (defer to the registry once it settles)', () => {
    expect(resolveRoomAccess({ access: 'invite' }, null)).toEqual({ access: 'invite', enc: undefined });
  });

  it('no registry row and no params: everything undefined', () => {
    expect(resolveRoomAccess({}, null)).toEqual({ access: undefined, enc: undefined });
  });
});
