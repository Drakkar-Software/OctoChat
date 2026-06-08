/**
 * React hook over the SDK's framework-agnostic Argon2id progress emitter
 * ({@link subscribeArgon2Progress}). Returns the current derivation progress (0..1)
 * while a seed→identity Argon2id run is in flight, or `null` when idle. Onboarding
 * screens use it to show a percentage during the (~30–120 s on Hermes) derivation so
 * the button doesn't look frozen. The pure emitter + the argon2 polyfill itself live
 * in the SDK (`platform/hash-wasm-shim.ts`); this is the thin React wrapper.
 */
import { useEffect, useState } from 'react';

import { subscribeArgon2Progress } from '@drakkar.software/octochat-sdk';

export function useArgon2Progress(): number | null {
  const [p, setP] = useState<number | null>(null);
  useEffect(() => subscribeArgon2Progress(setP), []);
  return p;
}
