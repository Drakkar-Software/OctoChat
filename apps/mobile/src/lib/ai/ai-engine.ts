/**
 * On-device AI engine — web/default stub. expo-ai-kit calls requireNativeModule('ExpoAiKit')
 * at module-load, which crashes the web bundle. All expo-ai-kit value imports are contained
 * in ai-engine.native.ts; this file exports an identical contract that is always inert.
 *
 * Keep the two files contract-identical.
 */
import type { BuiltInModel, DownloadableModel, LLMMessage, ModelErrorCode } from 'expo-ai-kit';

export type { BuiltInModel, DownloadableModel, LLMMessage, ModelErrorCode };

export interface AiStreamHandle {
  promise: Promise<{ text: string }>;
  stop: () => void;
}

export interface AiStreamOptions {
  systemPrompt?: string;
  onToken: (event: { token: string; accumulatedText: string; isDone: boolean }) => void;
}

export function aiIsAvailable(): Promise<boolean> {
  return Promise.resolve(false);
}

export function aiGetBuiltInModels(): Promise<BuiltInModel[]> {
  return Promise.resolve([]);
}

export function aiGetDownloadableModels(): Promise<DownloadableModel[]> {
  return Promise.resolve([]);
}

export function aiGetRecommendedModel(): Promise<DownloadableModel | null> {
  return Promise.resolve(null);
}

export function aiDownloadModel(_id: string, _onProgress?: (p: number) => void): Promise<void> {
  return Promise.resolve();
}

export function aiCancelDownload(_id: string): Promise<void> {
  return Promise.resolve();
}

export function aiDeleteModel(_id: string): Promise<void> {
  return Promise.resolve();
}

export function aiSetModel(_id: string): Promise<void> {
  return Promise.resolve();
}

export function aiUnloadModel(): Promise<void> {
  return Promise.resolve();
}

export function aiGetActiveModel(): string {
  return '';
}

export function aiStream(_messages: LLMMessage[], _opts: AiStreamOptions): AiStreamHandle {
  return { promise: Promise.resolve({ text: '' }), stop() {} };
}

export function aiErrorCode(_e: unknown): ModelErrorCode | null {
  return null;
}
