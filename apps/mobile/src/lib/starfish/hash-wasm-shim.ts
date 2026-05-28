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
 */
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

/** Named export mirroring `import { argon2id } from 'hash-wasm'`. */
export async function argon2id(options: Argon2idOptions): Promise<Uint8Array> {
  return argon2idAsync(options.password, options.salt, {
    t: options.iterations,
    m: options.memorySize,
    p: options.parallelism,
    dkLen: options.hashLength,
  });
}
