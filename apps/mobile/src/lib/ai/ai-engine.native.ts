/**
 * On-device AI engine — native wrapper around expo-ai-kit. This is the ONLY file that
 * value-imports expo-ai-kit; the bare ai-engine.ts is the web/default stub. Metro resolves
 * *.native.ts first on iOS/Android and falls back to the bare *.ts on web.
 *
 * Keep the two files contract-identical.
 */
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  getActiveModel,
  getBuiltInModels,
  getDownloadableModels,
  getRecommendedModel,
  isAvailable,
  ModelError,
  setModel,
  streamMessage,
  unloadModel,
} from 'expo-ai-kit';
import type { BuiltInModel, DownloadableModel, InferenceBackend, LLMMessage, ModelErrorCode } from 'expo-ai-kit';

export type { BuiltInModel, DownloadableModel, InferenceBackend, LLMMessage, ModelErrorCode };

export interface AiStreamHandle {
  promise: Promise<{ text: string }>;
  stop: () => void;
}

export interface AiStreamOptions {
  systemPrompt?: string;
  onToken: (event: { token: string; accumulatedText: string; isDone: boolean }) => void;
}

export { isAvailable as aiIsAvailable };
export { getBuiltInModels as aiGetBuiltInModels };
export { getDownloadableModels as aiGetDownloadableModels };
export { getRecommendedModel as aiGetRecommendedModel };
export { unloadModel as aiUnloadModel };
export { getActiveModel as aiGetActiveModel };

export function aiSetModel(id: string, backend?: InferenceBackend): Promise<void> {
  return setModel(id, backend ? { backend } : undefined);
}

export function aiDownloadModel(id: string, onProgress?: (p: number) => void): Promise<void> {
  return downloadModel(id, onProgress ? { onProgress } : undefined);
}

export function aiCancelDownload(id: string): Promise<void> {
  return cancelDownload(id);
}

export function aiDeleteModel(id: string): Promise<void> {
  return deleteModel(id);
}

export function aiStream(messages: LLMMessage[], opts: AiStreamOptions): AiStreamHandle {
  const { promise, stop } = streamMessage(
    messages,
    (evt) => opts.onToken({ token: evt.token, accumulatedText: evt.accumulatedText, isDone: evt.isDone }),
    opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : undefined,
  );
  return { promise, stop };
}

export function aiErrorCode(e: unknown): ModelErrorCode | null {
  if (e instanceof ModelError) return e.code;
  return null;
}
