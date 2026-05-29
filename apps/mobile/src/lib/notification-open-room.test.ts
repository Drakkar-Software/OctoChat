import { beforeEach, describe, expect, it, vi } from 'vitest';

// The resolver's only runtime import is `expo-router`; `RoomsRegistryEntry` is
// type-only/erased and `starfish/paths` is pure (type-only import), so stubbing the
// router is enough to run it under Node.
vi.mock('expo-router', () => ({ router: { push: vi.fn(), navigate: vi.fn() } }));

import { router } from 'expo-router';

import type { RoomsRegistryEntry } from './rooms-registry-context';
import { openRoomFromNotification, type OpenRoomFromNotificationDeps } from './notification-open-room';

// A rooms registry that knows `sp-abc-general` (a stream) — anything else is unknown.
const entry = {
  rooms: [{ id: 'sp-abc-general', name: 'general', kind: 'stream' }],
} as unknown as RoomsRegistryEntry;

const makeDeps = (overrides: Partial<OpenRoomFromNotificationDeps> = {}): OpenRoomFromNotificationDeps => ({
  ensure: vi.fn(async () => entry),
  setActiveId: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.mocked(router.push).mockClear();
  vi.mocked(router.navigate).mockClear();
});

describe('openRoomFromNotification', () => {
  it('resolves the real name/kind from the registry and focuses the space', async () => {
    const deps = makeDeps();
    await openRoomFromNotification({ spaceId: 'sp-abc', roomId: 'sp-abc-general' }, deps);
    expect(deps.setActiveId).toHaveBeenCalledWith('sp-abc');
    expect(deps.ensure).toHaveBeenCalledWith('sp-abc');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/room/[id]',
      params: { id: 'sp-abc-general', name: 'general', kind: 'stream' },
    });
  });

  it('derives the space id from the room id when none is given', async () => {
    const deps = makeDeps();
    await openRoomFromNotification({ roomId: 'sp-abc-general' }, deps);
    expect(deps.setActiveId).toHaveBeenCalledWith('sp-abc');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/room/[id]',
      params: { id: 'sp-abc-general', name: 'general', kind: 'stream' },
    });
  });

  it('accepts a native public-space push that carries the room id as docId', async () => {
    const deps = makeDeps();
    await openRoomFromNotification({ spaceId: 'sp-abc', docId: 'sp-abc-general' }, deps);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/room/[id]',
      params: { id: 'sp-abc-general', name: 'general', kind: 'stream' },
    });
  });

  it('falls back to opening by bare id when the registry does not know the room', async () => {
    const deps = makeDeps();
    await openRoomFromNotification({ spaceId: 'sp-abc', roomId: 'sp-abc-mystery' }, deps);
    expect(deps.setActiveId).toHaveBeenCalledWith('sp-abc');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/room/[id]',
      params: { id: 'sp-abc-mystery' },
    });
  });

  it('falls back to bare id when the registry read rejects', async () => {
    const deps = makeDeps({ ensure: vi.fn(async () => { throw new Error('offline'); }) });
    await openRoomFromNotification({ roomId: 'sp-abc-general' }, deps);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/room/[id]',
      params: { id: 'sp-abc-general' },
    });
  });

  it('lands on the rooms tab (focused on the space) when only the space is known', async () => {
    const deps = makeDeps();
    await openRoomFromNotification({ spaceId: 'sp-abc' }, deps);
    expect(deps.setActiveId).toHaveBeenCalledWith('sp-abc'); // side effect before the early return
    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/rooms');
    expect(router.push).not.toHaveBeenCalled();
    expect(deps.ensure).not.toHaveBeenCalled();
  });

  it('is a no-op when neither a room nor a space id is present', async () => {
    const deps = makeDeps();
    await openRoomFromNotification({}, deps);
    expect(deps.setActiveId).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
