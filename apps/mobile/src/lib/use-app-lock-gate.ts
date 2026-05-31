/**
 * Runtime state for the native biometric lock overlay — web stub. The web build gates at
 * the vault layer (a cold-start PIN/passkey screen), so there is no separate runtime
 * gate here: it reports always-unlocked and `AppLockGate` renders nothing. The native
 * variant (`use-app-lock-gate.native.ts`) drives the real lock/foreground logic.
 */
export interface AppLockGateState {
  /** Whether the lock overlay should cover the app right now. */
  locked: boolean;
  /** The biometric prompt is currently up. */
  authing: boolean;
  /** Last failed-auth message, or null. */
  error: string | null;
  /** Re-run the biometric prompt (the overlay's Unlock button). */
  unlock: () => void;
}

export function useAppLockGate(): AppLockGateState {
  return { locked: false, authing: false, error: null, unlock: () => {} };
}
