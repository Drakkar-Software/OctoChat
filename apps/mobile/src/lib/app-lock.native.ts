/**
 * App-lock on native — an optional biometric gate in front of the app. The vault is
 * already encrypted at rest by the OS Keychain (see `starfish/storage.native.ts`), so
 * this does NOT seal anything; it gates the UI with Face ID / Touch ID / fingerprint so
 * a found-unlocked phone can't read the chat. The on/off choice is a local-device flag
 * (a screen-lock preference, not synced state), held in SecureStore.
 *
 * The web build has no biometric gate (it locks the seed with a PIN/passkey instead),
 * so `app-lock.ts` stubs every export — keep the two files contract-identical.
 */
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const FLAG_KEY = 'octochat_applock_biometric_v1';

// Module-level mirror of the enabled flag. SecureStore is the source of truth, but its
// reads are async; the gate needs the value SYNCHRONOUSLY (to cover the app-switcher
// snapshot the instant the app deactivates) and needs it to reflect a settings toggle
// without a process restart. enable/disable update it, every async read hydrates it, and
// because the settings hook and the gate share this one module they see the same value.
let enabledCache = false;

/** Last-known enabled flag, synchronous. Hydrated by {@link isBiometricLockEnabled}. */
export function biometricLockEnabledSync(): boolean {
  return enabledCache;
}

/** Hardware present AND at least one biometric enrolled at the OS level. */
export async function biometricSupported(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Whether the user has turned the biometric app-lock on. */
export async function isBiometricLockEnabled(): Promise<boolean> {
  try {
    enabledCache = (await SecureStore.getItemAsync(FLAG_KEY)) === '1';
    return enabledCache;
  } catch {
    return false;
  }
}

/** Run the OS biometric prompt; resolves true only on a successful match. */
export async function authenticateBiometric(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock OctoChat',
      cancelLabel: 'Cancel',
      // Allow the device passcode as a fallback so a flaky/again-prompted biometric can
      // still let the owner in — and so removing biometrics at the OS level can't fully
      // strand them (the gate also auto-bypasses an unenforceable lock, see the gate).
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

/**
 * Turn the lock on — but only after a live auth confirms the user actually controls the
 * biometric, so we never persist a flag the owner can't satisfy. Returns false (and
 * leaves the flag off) when biometrics are unavailable or the confirming auth fails.
 */
export async function enableBiometricLock(): Promise<boolean> {
  if (!(await biometricSupported())) return false;
  if (!(await authenticateBiometric())) return false;
  try {
    await SecureStore.setItemAsync(FLAG_KEY, '1');
    enabledCache = true;
    return true;
  } catch {
    return false;
  }
}

/** Turn the lock off (clears the stored flag). */
export async function disableBiometricLock(): Promise<void> {
  // Mirror to the cache first so the gate/settings agree the lock is off even if the
  // SecureStore delete throws (a stuck flag with the cache off is the safe failure).
  enabledCache = false;
  try {
    await SecureStore.deleteItemAsync(FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/** Human label for the strongest available modality, for settings copy. */
export async function biometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === 'ios' ? 'Face ID' : 'face unlock';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === 'ios' ? 'Touch ID' : 'fingerprint';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris unlock';
  } catch {
    /* fall through */
  }
  return 'biometrics';
}
