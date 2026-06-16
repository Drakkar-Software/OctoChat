import { beforeEach, describe, expect, it } from 'vitest';
import { configureKv } from '@drakkar.software/octospaces-sdk';
import {
  getMutePrefs,
  hydrateMutes,
  isMuteActive,
  isRoomMuted,
  loadMutesFromKv,
  resetMutes,
  setRoomMute,
} from './mutes';

const store = new Map<string, string>();
const SESSION = { userId: 'u', accountClient: {}, spacesRegistryClient: {} } as never;

beforeEach(() => {
  store.clear();
  configureKv({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    remove: async (k) => { store.delete(k); },
  });
  resetMutes();
});

describe('isMuteActive', () => {
  it('returns true for boolean true', () => expect(isMuteActive(true)).toBe(true));
  it('returns false for undefined', () => expect(isMuteActive(undefined)).toBe(false));
  it('returns true for a future timestamp', () => expect(isMuteActive(Date.now() + 100_000)).toBe(true));
  it('returns false for a past timestamp', () => expect(isMuteActive(Date.now() - 1)).toBe(false));
});

describe('setRoomMute / isRoomMuted', () => {
  it('applies an optimistic mute immediately (before server round-trip)', () => {
    void setRoomMute(SESSION, 'r1', true);
    expect(isRoomMuted('r1')).toBe(true);
  });
});

describe('hydrateMutes', () => {
  it('applies server prefs to an empty cache', async () => {
    await hydrateMutes('u', { rooms: { r2: true }, spaces: {} });
    expect(isRoomMuted('r2')).toBe(true);
    expect(getMutePrefs().spaces).toEqual({});
  });

  it('writes under the octochat.mutes.* key (KV namespace lock-in)', async () => {
    await hydrateMutes('u', { rooms: { r1: true }, spaces: {} });
    expect(store.has('octochat.mutes.u')).toBe(true);
  });

  it('skips emit when prefs are unchanged (no spurious re-renders)', async () => {
    const prefs = { rooms: { r1: true }, spaces: {} };
    await hydrateMutes('u', prefs);
    const snapshot = getMutePrefs();
    await hydrateMutes('u', prefs);
    expect(getMutePrefs()).toBe(snapshot); // same reference = no re-render
  });
});

describe('loadMutesFromKv', () => {
  it('reads back prefs written by hydrateMutes', async () => {
    await hydrateMutes('u', { rooms: { r1: true }, spaces: { s1: true } });
    resetMutes();
    const prefs = await loadMutesFromKv('u');
    expect(prefs.rooms['r1']).toBe(true);
    expect(prefs.spaces['s1']).toBe(true);
  });
});
