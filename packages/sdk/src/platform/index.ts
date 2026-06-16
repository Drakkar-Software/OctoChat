/**
 * Optional platform-adapter barrel (WEB) for `@drakkar.software/octochat-sdk/platform`.
 *
 * The SDK CORE (`@drakkar.software/octochat-sdk`) stays platform-agnostic and
 * dependency-free; THIS subpath is the opt-in layer a host wires at boot: the kv store
 * (fed into `configureKv`), the seed vault, WebAuthn passkeys, and the crypto install
 * (`configureStarfishPlatform`). The native build lives in `index.native.ts` and is
 * selected by Metro's `react-native` export condition / `.native` resolution.
 */
import { createVaultStorage, enrollPasskey as _enrollPasskey } from '@drakkar.software/octospaces-platform-sdk';
import type { VaultLoad, UnlockMethod, Vault, SeedLock, PasskeyEnrollment } from '@drakkar.software/octospaces-sdk';

export { kvGet, kvSet, kvRemove } from '@drakkar.software/octospaces-platform-sdk';
export { configureStarfishPlatform } from '@drakkar.software/octospaces-platform-sdk';
export { passkeySupported, passkeyEnrollable, evalPasskey } from '@drakkar.software/octospaces-platform-sdk';
export type { PersistedSession } from '@drakkar.software/octospaces-sdk';

const _vault = createVaultStorage({ storageKey: 'octochat.session.v1' });

export const loadVault = (): Promise<VaultLoad> => _vault.loadVault();
export const vaultMethods = (): UnlockMethod[] => _vault.vaultMethods();
export const unlockVault = (method: UnlockMethod, pin?: string): Promise<Vault> => _vault.unlockVault(method, pin);
export const saveVault = (vault: Vault, lock?: SeedLock): Promise<void> => _vault.saveVault(vault, lock);
export const addPasskeyToVault = (passkey: PasskeyEnrollment): Promise<void> => _vault.addPasskeyToVault(passkey);
export const removePasskeyFromVault = (): Promise<void> => _vault.removePasskeyFromVault();
export const clearVault = (): Promise<void> => _vault.clearVault();

export const enrollPasskey = (displayName: string): Promise<PasskeyEnrollment> =>
  _enrollPasskey(displayName, 'OctoChat', 'octochat');
