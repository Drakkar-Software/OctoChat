import { createVaultStorage } from '@drakkar.software/octospaces-platform-sdk';
export type { PersistedSession } from '@drakkar.software/octospaces-sdk';

const _vault = createVaultStorage({ storageKey: 'octochat.session.v1' });

export const loadVault = () => _vault.loadVault();
export const vaultMethods = () => _vault.vaultMethods();
export const unlockVault = _vault.unlockVault.bind(_vault);
export const saveVault = _vault.saveVault.bind(_vault);
export const addPasskeyToVault = _vault.addPasskeyToVault.bind(_vault);
export const removePasskeyFromVault = () => _vault.removePasskeyFromVault();
export const clearVault = () => _vault.clearVault();
