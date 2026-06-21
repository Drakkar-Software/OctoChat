import { createReadsStore } from '@drakkar.software/octospaces-sdk';

const _store = createReadsStore({
  client: (s) => s.spacesRegistryClient,
  kvNamespace: 'octochat',
  logTag: '[OctoChat]',
});

export const getReadPrefs = () => _store.getReadPrefs();
export const getRoomReadAt = (roomId: string) => _store.getNodeReadAt(roomId);
export const subscribeReads = (listener: () => void) => _store.subscribeReads(listener);
export const loadReadMarksFromKv = _store.loadReadMarksFromKv.bind(_store);
export const hydrateReads = _store.hydrateReads.bind(_store);
export const resetReads = () => _store.resetReads();
export const flushReadsNow = () => _store.flushReadsNow();
export const setRoomReadAt = _store.setNodeReadAt.bind(_store);
