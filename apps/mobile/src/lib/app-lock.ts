/**
 * App-lock (native biometric gate) — web stub. The web build secures the seed at the
 * vault layer (a PIN, plus an optional WebAuthn passkey — see `starfish/storage.ts`),
 * so there is no separate biometric app-lock here: every probe reports
 * unsupported/disabled and the runtime gate (use-app-lock-gate) stays inert. The native
 * variant (`app-lock.native.ts`) backs these with `expo-local-authentication` + a
 * SecureStore flag.
 */

/** Last-known enabled flag, synchronous (always false on web). */
export function biometricLockEnabledSync(): boolean {
  return false;
}

/** Hardware present AND a biometric enrolled at the OS level (always false on web). */
export async function biometricSupported(): Promise<boolean> {
  return false;
}

/** Whether the user has turned the biometric app-lock on. */
export async function isBiometricLockEnabled(): Promise<boolean> {
  return false;
}

/** Run the OS biometric prompt; true only on a successful match. */
export async function authenticateBiometric(): Promise<boolean> {
  return true;
}

/** Turn the lock on after a confirming auth; false if it could not be enabled. */
export async function enableBiometricLock(): Promise<boolean> {
  return false;
}

/** Turn the lock off (clears the stored flag). */
export async function disableBiometricLock(): Promise<void> {
  /* no-op on web */
}

/** Human label for the available modality, for settings copy. */
export async function biometricLabel(): Promise<string> {
  return 'biometrics';
}
