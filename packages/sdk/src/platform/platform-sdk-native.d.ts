/**
 * Module augmentation — adds the native exports from `@drakkar.software/octospaces-platform-sdk`
 * that TypeScript cannot see when `moduleResolution: Bundler` resolves the web barrel (index.d.ts).
 * Metro resolves index.native.js at runtime, which exports these correctly.
 * Remove this file once octospaces-platform-sdk@0.1.1 (exports fix) is installed.
 */
export type {};

declare module '@drakkar.software/octospaces-platform-sdk' {
  export interface VaultStorageNative {
    loadVault(): Promise<import('@drakkar.software/octospaces-sdk').VaultLoad>;
    vaultMethods(): import('@drakkar.software/octospaces-sdk').UnlockMethod[];
    unlockVault(
      method: import('@drakkar.software/octospaces-sdk').UnlockMethod,
      pin?: string,
    ): Promise<import('@drakkar.software/octospaces-sdk').Vault>;
    saveVault(
      vault: import('@drakkar.software/octospaces-sdk').Vault,
      lock?: import('@drakkar.software/octospaces-sdk').SeedLock,
    ): Promise<void>;
    addPasskeyToVault(
      passkey: import('@drakkar.software/octospaces-sdk').PasskeyEnrollment,
    ): Promise<void>;
    removePasskeyFromVault(): Promise<void>;
    clearVault(): Promise<void>;
    passkeySupported(): boolean;
  }
  export function createVaultStorageNative(opts: {
    storageKey: string;
  }): VaultStorageNative;
}
