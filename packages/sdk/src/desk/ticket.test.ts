import { describe, expect, it } from 'vitest';

import type { ObjectNode } from '../domain/types';
import { defaultTicketMeta, isTicketNode, isTicketRoomId, ticketOf, withTicket, ticketMetaForIndex, clampField, TICKET_TITLE_MAX } from './ticket';

const baseNode = (overrides: Partial<ObjectNode> = {}): ObjectNode => ({
  id: 'ticket-001',
  type: 'ticket',
  parentId: null,
  order: 0,
  title: 'Test ticket',
  updatedAt: Date.now(),
  ...overrides,
});

describe('defaultTicketMeta', () => {
  it('initializes with status open and default medium priority', () => {
    const meta = defaultTicketMeta({ title: 'My subject', requester: 'alice@example.com' });
    expect(meta.status).toBe('open');
    expect(meta.priority).toBe('medium');
    expect(meta.assigneeId).toBeNull();
    expect(meta.requester).toBe('alice@example.com');
    expect(meta.slaDueAt).toBeNull();
  });

  it('respects an explicit priority', () => {
    const meta = defaultTicketMeta({ title: 'T', requester: 'bob', priority: 'urgent' });
    expect(meta.priority).toBe('urgent');
  });

  it('stores the title and clamps over-long / control-char fields', () => {
    const ctrl = `a${String.fromCharCode(0)}b@x.io`;
    const meta = defaultTicketMeta({ title: 'A'.repeat(TICKET_TITLE_MAX + 50), requester: ctrl });
    expect(meta.title).toHaveLength(TICKET_TITLE_MAX);
    expect(meta.requester).toBe('a b@x.io'); // control char collapsed to space
  });
});

describe('clampField', () => {
  it('truncates and collapses control characters', () => {
    expect(clampField('hi\nthere', 100)).toBe('hi there');
    expect(clampField('x'.repeat(10), 4)).toBe('xxxx');
  });
});

describe('ticketMetaForIndex', () => {
  const meta = defaultTicketMeta({ title: 'Secret subject', requester: 'victim@example.com' });

  it('plaintext ticket: keeps title + requester in the index meta', () => {
    const idx = ticketMetaForIndex(meta, false);
    expect(idx.title).toBe('Secret subject');
    expect(idx.requester).toBe('victim@example.com');
  });

  it('E2EE ticket: STRIPS title + requester from the index meta (no PII in the all-member index)', () => {
    const idx = ticketMetaForIndex(meta, true);
    expect(idx.title).toBe('');
    expect(idx.requester).toBe('');
    // Non-sensitive fields are preserved.
    expect(idx.status).toBe('open');
    expect(idx.priority).toBe('medium');
  });
});

describe('ticketOf', () => {
  it('returns null for non-ticket nodes', () => {
    expect(ticketOf(baseNode({ type: 'room' }))).toBeNull();
  });

  it('returns null when meta.ticket is absent', () => {
    expect(ticketOf(baseNode({ meta: undefined }))).toBeNull();
  });

  it('returns the TicketMeta when present', () => {
    const ticket = defaultTicketMeta({ title: 'T', requester: 'alice' });
    const node = baseNode({ meta: { ticket } });
    expect(ticketOf(node)).toEqual(ticket);
  });
});

describe('withTicket', () => {
  it('merges a patch onto the existing meta.ticket', () => {
    const ticket = defaultTicketMeta({ title: 'T', requester: 'alice' });
    const node = baseNode({ meta: { ticket } });
    const updated = withTicket(node, { status: 'solved', assigneeId: 'user-99' });
    const result = updated.meta?.ticket as typeof ticket;
    expect(result.status).toBe('solved');
    expect(result.assigneeId).toBe('user-99');
    expect(result.requester).toBe('alice'); // unchanged field preserved
    expect(result.priority).toBe('medium'); // unchanged field preserved
  });

  it('falls back to default values when meta.ticket is absent', () => {
    const node = baseNode({ meta: undefined });
    const updated = withTicket(node, { status: 'closed' });
    const result = updated.meta?.ticket as ReturnType<typeof defaultTicketMeta>;
    expect(result.status).toBe('closed');
    expect(result.priority).toBe('medium');
    expect(result.requester).toBe('');
  });

  it('preserves other meta keys alongside ticket', () => {
    const node = baseNode({ meta: { ticket: defaultTicketMeta({ title: 'T', requester: 'x' }), other: 42 } });
    const updated = withTicket(node, { status: 'pending' });
    expect((updated.meta as Record<string, unknown>)['other']).toBe(42);
  });
});

describe('isTicketNode', () => {
  it('returns true for ticket nodes', () => {
    expect(isTicketNode(baseNode({ type: 'ticket' }))).toBe(true);
  });

  it('returns false for non-ticket nodes', () => {
    expect(isTicketNode(baseNode({ type: 'room' }))).toBe(false);
    expect(isTicketNode(baseNode({ type: 'automation' }))).toBe(false);
  });
});

describe('isTicketRoomId', () => {
  it('returns true for a ticket room id', () => {
    expect(isTicketRoomId('ticket-deadbeef')).toBe(true);
  });

  it('returns false for space / DM / public room ids (which DO embed a space)', () => {
    expect(isTicketRoomId('sp-abc-general')).toBe(false);
    expect(isTicketRoomId('dm-abc-dm')).toBe(false);
    expect(isTicketRoomId('psp-abc-room')).toBe(false);
  });
});
