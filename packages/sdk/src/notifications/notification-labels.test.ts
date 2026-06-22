/**
 * Unit tests for notification-labels.ts — the optional explicit `spaceId` must take
 * precedence over the lossy `spaceIdFromRoomId(roomId)` derivation, which is wrong for
 * `ticket-<hex>` room ids (no embedded space) and would open a bogus space client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────────

const mockGetSpaceClient = vi.fn((spaceId: string) => ({ __space: spaceId }));
vi.mock('@drakkar.software/starfish-spaces', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), getSpaceClient: (...a: unknown[]) => mockGetSpaceClient(...a) };
});

const mockReadSpaceAccess = vi.fn(async () => ({ name: 'Desk Space', owner: 'u1', members: [] as string[] }));
vi.mock('../starfish/registry', () => ({
  readSpaceAccess: (...a: unknown[]) => mockReadSpaceAccess(...a),
}));

const mockReadIndexRooms = vi.fn(async () => ({ rooms: [] as unknown[], categories: [] as unknown[] }));
vi.mock('../starfish/object-index', () => ({
  readIndexRooms: (...a: unknown[]) => mockReadIndexRooms(...a),
}));

import { loadNotificationLabels } from './notification-labels';
import type { Session } from '../starfish/identity';

const SESSION = { userId: 'u1', name: 'Alice' } as unknown as Session;
// spaceIdFromRoomId('ticket-deadbeef') === 'ticket-deadbeef' (a bogus, non-existent space).
const TICKET_ID = 'ticket-deadbeef';

beforeEach(() => {
  mockGetSpaceClient.mockReset();
  mockReadSpaceAccess.mockReset();
  mockReadIndexRooms.mockReset();
  mockGetSpaceClient.mockImplementation((spaceId: string) => ({ __space: spaceId }));
  mockReadSpaceAccess.mockResolvedValue({ name: 'Desk Space', owner: 'u1', members: [] });
  mockReadIndexRooms.mockResolvedValue({ rooms: [], categories: [] });
});

describe('loadNotificationLabels — explicit spaceId', () => {
  it('resolves a ticket room via the passed space (not the lossy id derivation)', async () => {
    mockReadIndexRooms.mockResolvedValue({
      rooms: [{ id: TICKET_ID, name: 'Broken login', kind: 'channel' }],
      categories: [],
    });

    const labels = await loadNotificationLabels(SESSION, TICKET_ID, 'sp-desk');

    expect(mockGetSpaceClient).toHaveBeenCalledWith('sp-desk', SESSION);
    expect(labels).toEqual({ spaceName: 'Desk Space', roomName: 'Broken login', roomKind: 'channel' });
  });

  it('without an explicit spaceId, derives it from the room id (lossy — back-compat)', async () => {
    await loadNotificationLabels(SESSION, 'sp-abc-general');
    expect(mockGetSpaceClient).toHaveBeenCalledWith('sp-abc', SESSION);
  });

  it('a ticket id with no explicit space opens a bogus space (the bug the param fixes)', async () => {
    await loadNotificationLabels(SESSION, TICKET_ID);
    expect(mockGetSpaceClient).toHaveBeenCalledWith('ticket-deadbeef', SESSION);
  });
});
