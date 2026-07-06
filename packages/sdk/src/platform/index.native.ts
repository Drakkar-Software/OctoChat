/**
 * Optional platform-adapter barrel (NATIVE) for `@drakkar.software/octochat-sdk/platform`.
 *
 * Mirrors `index.ts`'s symbol surface with React Native implementations:
 * AsyncStorage kv, expo-secure-store vault, a passkey stub (native uses OS biometrics,
 * not WebAuthn), and react-native-quick-crypto install. Selected by Metro's
 * `react-native` export condition / `.native` resolution.
 */
import { createVaultStorageNative, enrollPasskey as _enrollPasskey } from '@drakkar.software/dk-spaces-platform-sdk';
import type { PasskeyEnrollment } from '@drakkar.software/starfish-spaces';

export { kvGet, kvSet, kvRemove } from '@drakkar.software/dk-spaces-platform-sdk';
export { configureStarfishPlatform } from '@drakkar.software/dk-spaces-platform-sdk';
export { passkeySupported, passkeyEnrollable, evalPasskey } from '@drakkar.software/dk-spaces-platform-sdk';
export type { PersistedSession } from '@drakkar.software/starfish-spaces';

const _vault = createVaultStorageNative({ storageKey: 'octochat_session_v1' });

export const loadVault = () => _vault.loadVault();
export const vaultMethods = () => _vault.vaultMethods();
export const unlockVault = _vault.unlockVault.bind(_vault);
export const saveVault = _vault.saveVault.bind(_vault);
export const addPasskeyToVault = _vault.addPasskeyToVault.bind(_vault);
export const removePasskeyFromVault = () => _vault.removePasskeyFromVault();
export const clearVault = () => _vault.clearVault();

export const enrollPasskey = (displayName: string): Promise<PasskeyEnrollment> =>
  _enrollPasskey(displayName, 'OctoChat', 'octochat');
