/**
 * Module augmentation — provides `createVaultStorageNative` to TypeScript when
 * `packages/sdk` typechecks (`moduleResolution: Bundler`, no `customConditions`).
 * In that pass, `@drakkar.software/dk-spaces-platform-sdk` resolves to the web
 * barrel (`index.d.ts`) which only exports `createVaultStorage`. `index.native.ts`
 * (this SDK's native platform barrel) imports `createVaultStorageNative`, so without
 * this shim the SDK typecheck fails on that import.
 *
 * Note: `apps/mobile` typechecks with `customConditions: ['react-native']` (from
 * expo/tsconfig.base) and resolves `octochat-sdk/platform` to `index.native.ts` via
 * its tsconfig.json `paths` alias. Under that condition, platform-sdk 0.1.1+ resolves
 * to `index.native.d.ts` which declares `createVaultStorageNative` natively — so the
 * shim is not needed (and not included) for that compilation pass.
 *
 * This shim must remain for the `packages/sdk` typecheck pass (no react-native
 * condition). It would only be removable if packages/sdk added `customConditions:
 * ['react-native']`, but that would break the parallel web barrel (`index.ts`) check.
 */
export type {};

declare module '@drakkar.software/dk-spaces-platform-sdk' {
  export interface VaultStorageNative {
    loadVault(): Promise<import('@drakkar.software/starfish-spaces').VaultLoad>;
    vaultMethods(): import('@drakkar.software/starfish-spaces').UnlockMethod[];
    unlockVault(
      method: import('@drakkar.software/starfish-spaces').UnlockMethod,
      pin?: string,
    ): Promise<import('@drakkar.software/starfish-spaces').Vault>;
    saveVault(
      vault: import('@drakkar.software/starfish-spaces').Vault,
      lock?: import('@drakkar.software/starfish-spaces').SeedLock,
    ): Promise<void>;
    addPasskeyToVault(
      passkey: import('@drakkar.software/starfish-spaces').PasskeyEnrollment,
    ): Promise<void>;
    removePasskeyFromVault(): Promise<void>;
    clearVault(): Promise<void>;
    passkeySupported(): boolean;
  }
  export function createVaultStorageNative(opts: {
    storageKey: string;
  }): VaultStorageNative;
}
