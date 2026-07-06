/**
 * dk-spaces-sdk 0.31 stopped wrapping the mute store — `createMutesStore` is gone.
 * Build the generic `createPrefsStore` directly with dk-spaces-sdk's mute config
 * preset, and re-derive the old room/space-specific method names this module used
 * to expose (the generic store only has `get`/`mutate`/`subscribe`/etc.).
 */
import { createPrefsStore, type MutePrefs, type Session } from '@drakkar.software/starfish-spaces';
import { mutePrefsConfig, isMuteActive, applyMute } from '@drakkar.software/dk-spaces-sdk';

const _store = createPrefsStore<MutePrefs>({
  ...mutePrefsConfig('octochat'),
  client: (s) => s.spacesRegistryClient,
});

export { isMuteActive };
export const getMutePrefs = () => _store.get();
export const isRoomMuted = (roomId: string) => isMuteActive(_store.get().nodes[roomId]);
export const isSpaceMuted = (spaceId: string) => isMuteActive(_store.get().spaces[spaceId]);
export const isMuted = (roomId: string, spaceId: string) => isRoomMuted(roomId) || isSpaceMuted(spaceId);
export const subscribeMutes = (listener: () => void) => _store.subscribe(listener);
export const hydrateMutes = (userId: string, serverPrefs: MutePrefs) => _store.hydrate(userId, serverPrefs);
export const resetMutes = () => _store.reset();
export const loadMutesFromKv = (userId: string) => _store.loadFromKv(userId);
export const setRoomMute = (session: Session, roomId: string, muted: boolean) =>
  _store.mutate(session, (cur) => applyMute(cur, 'nodes', roomId, muted));
export const setSpaceMute = (session: Session, spaceId: string, muted: boolean) =>
  _store.mutate(session, (cur) => applyMute(cur, 'spaces', spaceId, muted));
