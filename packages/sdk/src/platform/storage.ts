import { createVaultStorage } from '@drakkar.software/octospaces-platform-sdk';
import type { VaultLoad, UnlockMethod, Vault, SeedLock, PasskeyEnrollment } from '@drakkar.software/octospaces-sdk';
export type { PersistedSession } from '@drakkar.software/octospaces-sdk';

const _vault = createVaultStorage({ storageKey: 'octochat.session.v1' });

export const loadVault = (): Promise<VaultLoad> => _vault.loadVault();
export const vaultMethods = (): UnlockMethod[] => _vault.vaultMethods();
export const unlockVault = (method: UnlockMethod, pin?: string): Promise<Vault> => _vault.unlockVault(method, pin);
export const saveVault = (vault: Vault, lock?: SeedLock): Promise<void> => _vault.saveVault(vault, lock);
export const addPasskeyToVault = (passkey: PasskeyEnrollment): Promise<void> => _vault.addPasskeyToVault(passkey);
export const removePasskeyFromVault = (): Promise<void> => _vault.removePasskeyFromVault();
export const clearVault = (): Promise<void> => _vault.clearVault();
