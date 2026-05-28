/**
 * Drop-in for the slice of `hash-wasm` the Starfish SDK uses.
 *
 * `@drakkar.software/starfish-identities` derives the root identity and seal
 * keys with Argon2id from `hash-wasm`, which hard-requires a `WebAssembly`
 * global and throws "WebAssembly is not supported in this environment!" when it
 * is missing — surfaced in onboarding as "Couldn't create identity". Hermes on
 * iOS/Android does not ship WebAssembly any more than the web JS fallback
 * does, so Metro redirects `hash-wasm` to this module on every platform (see
 * metro.config.js) and the bundle uses a pure-JS Argon2id instead.
 *
 * `@noble/hashes/argon2` is already a dependency and produces byte-identical
 * output for our locked params (verified against hash-wasm), so existing
 * identities/sealed envelopes still recover. We call the async variant so the
 * memory-hard derivation yields to the scheduler instead of freezing the UI.
 *
 * The SDK calls `argon2id` with no progress callback, so we surface progress
 * out-of-band via `subscribeArgon2Progress` / `useArgon2Progress`. Onboarding
 * screens use it to show a percentage while the (~30–120 s on Hermes)
 * derivation runs, so the button doesn't look frozen.
 */
import { useEffect, useState } from 'react';
import { argon2idAsync } from '@noble/hashes/argon2.js';

/** hash-wasm's `argon2id` options — only the fields the SDK passes. */
interface Argon2idOptions {
  password: string | Uint8Array;
  salt: Uint8Array;
  parallelism: number;
  iterations: number;
  memorySize: number; // KiB
  hashLength: number; // bytes
  outputType?: 'binary' | 'hex' | 'encoded';
}

type Listener = (progress: number | null) => void;
const listeners = new Set<Listener>();
let lastProgress: number | null = null;

function emit(progress: number | null) {
  lastProgress = progress;
  for (const fn of listeners) fn(progress);
}

/** Subscribe to Argon2id progress (0..1) and end-of-run (null). */
export function subscribeArgon2Progress(fn: Listener): () => void {
  listeners.add(fn);
  fn(lastProgress);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * React hook: returns the current Argon2id progress (0..1) while a derivation
 * is in flight, or `null` when idle.
 */
export function useArgon2Progress(): number | null {
  const [p, setP] = useState<number | null>(lastProgress);
  useEffect(() => subscribeArgon2Progress(setP), []);
  return p;
}

/** Named export mirroring `import { argon2id } from 'hash-wasm'`. */
export async function argon2id(options: Argon2idOptions): Promise<Uint8Array> {
  emit(0);
  try {
    return await argon2idAsync(options.password, options.salt, {
      t: options.iterations,
      m: options.memorySize,
      p: options.parallelism,
      dkLen: options.hashLength,
      onProgress: (frac) => emit(Math.max(0, Math.min(1, frac))),
    });
  } finally {
    emit(null);
  }
}
