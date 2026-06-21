import { createMutesStore, isMuteActive } from '@drakkar.software/octospaces-sdk';

const _store = createMutesStore({
  client: (s) => s.spacesRegistryClient,
  kvNamespace: 'octochat',
  logTag: '[OctoChat]',
});

export { isMuteActive };
export const getMutePrefs = () => _store.getMutePrefs();
export const isRoomMuted = (roomId: string) => _store.isNodeMuted(roomId);
export const isSpaceMuted = (spaceId: string) => _store.isSpaceMuted(spaceId);
export const isMuted = (roomId: string, spaceId: string) => _store.isMuted(roomId, spaceId);
export const subscribeMutes = (listener: () => void) => _store.subscribeMutes(listener);
export const hydrateMutes = _store.hydrateMutes.bind(_store);
export const resetMutes = () => _store.resetMutes();
export const loadMutesFromKv = _store.loadMutesFromKv.bind(_store);
export const setRoomMute = _store.setNodeMute.bind(_store);
export const setSpaceMute = _store.setSpaceMute.bind(_store);
