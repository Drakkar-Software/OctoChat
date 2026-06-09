/**
 * Lazily load a downloaded model into memory, exactly once, right before the
 * first inference. Splitting load-into-memory away from download is what keeps
 * the app alive: loading a multi-GB model is the single largest memory spike on
 * device, and doing it immediately after a download (when memory is already hot)
 * is what triggered the iOS OOM kill. Deferring it to a calm moment — and only
 * the first time — avoids that.
 *
 * `aiSetModel` is also the gatekeeper that makes inference use the downloaded
 * Gemma model rather than silently falling back to the platform built-in, so the
 * inference hooks must call this before streaming.
 */
import { Platform } from 'react-native';

import { aiGetActiveModel, aiSetModel } from './ai-engine';

let inFlightId: string | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Ensure `modelId` is the active in-memory model. No-op when `modelId` is null
 * (use the platform built-in) or it is already active. Concurrent callers for
 * the same id share one load; a failed load is not cached, so a later call can
 * retry.
 */
export async function ensureModelLoaded(modelId: string | null): Promise<void> {
  if (!modelId) return;
  if (aiGetActiveModel() === modelId) return;
  if (inFlightId !== modelId || !inFlight) {
    inFlightId = modelId;
    // Force the CPU backend on Android. LiteRT-LM's GPU backend needs the OpenCL
    // library, which many Android devices lack; there 'auto' can't recover — GPU
    // init succeeds but the first inference throws on an uncatchable native
    // coroutine and crashes the app. iOS uses Metal (no OpenCL), so it keeps the
    // default ('auto') backend.
    const backend = Platform.OS === 'android' ? 'cpu' : undefined;
    inFlight = aiSetModel(modelId, backend).finally(() => {
      inFlightId = null;
      inFlight = null;
    });
  }
  await inFlight;
}
