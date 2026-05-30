import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('./starfish/kv', () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
}));

const updateMutesDoc = vi.fn(async () => {});
vi.mock('./starfish/registry', () => ({
  updateMutesDoc: (...args: unknown[]) => (updateMutesDoc as (...a: unknown[]) => Promise<void>)(...args),
}));

import { hydrateMutes, isRoomMuted, resetMutes, setRoomMute } from './mutes';

const SESSION = { userId: 'u', accountClient: {} } as never;

beforeEach(() => {
  store.clear();
  updateMutesDoc.mockReset();
  updateMutesDoc.mockResolvedValue(undefined);
  resetMutes();
});

describe('hydrateMutes in-flight guard', () => {
  it('does not revert an optimistic mute while its server write is still pending', async () => {
    // Hold the sync round-trip open to simulate real server latency.
    let release = () => {};
    updateMutesDoc.mockImplementation(() => new Promise<void>((r) => (release = r)));

    const p = setRoomMute(SESSION, 'r1', true); // optimistic: muted; push in flight
    expect(isRoomMuted('r1')).toBe(true);

    // A navigation re-pull returns the STALE (still-unmuted) server doc — must be ignored
    // while the local write settles, or the toggle would visibly revert.
    await hydrateMutes('u', { rooms: {}, spaces: {} });
    expect(isRoomMuted('r1')).toBe(true);

    release();
    await p;

    // Once settled, a normal re-hydrate applies server state again (guard released).
    await hydrateMutes('u', { rooms: {}, spaces: {} });
    expect(isRoomMuted('r1')).toBe(false);
  });

  it('applies a remote mute change on a normal re-hydrate (no write in flight)', async () => {
    await hydrateMutes('u', { rooms: { r2: true }, spaces: {} });
    expect(isRoomMuted('r2')).toBe(true);
  });
});
