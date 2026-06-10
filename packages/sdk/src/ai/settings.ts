/**
 * Per-identity AI feature preferences, persisted to the platform KV store.
 * Module-level snapshot + listener pattern — mirrors the SDK's
 * quick-reactions-settings store.
 *
 * Defaults to disabled (opt-in) because enabling the feature may trigger a
 * multi-GB model download.
 */
import { kvGet, kvSet } from '../config/adapters';

export interface AiSettings {
  /** Master switch — enables reply suggestions and space summaries. */
  enabled: boolean;
  /** ID of the downloaded Gemma model to load on first inference; null = use the
   *  platform built-in (Apple FM / ML Kit). Only stored after a successful download. */
  activeModelId: string | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  activeModelId: null,
};

const settingsKey = (userId: string) => `octochat.ai.${userId}`;

let snapshot: AiSettings = DEFAULT_AI_SETTINGS;
const listeners = new Set<() => void>();

export function getAiSettings(): AiSettings {
  return snapshot;
}

export function subscribeAiSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAiSettings(next: AiSettings): void {
  snapshot = next;
  for (const l of listeners) l();
}

export function resetAiSettings(): void {
  setAiSettings(DEFAULT_AI_SETTINGS);
}

function coerce(raw: unknown): AiSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_AI_SETTINGS;
  const r = raw as Partial<Record<keyof AiSettings, unknown>>;
  const enabled = typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_AI_SETTINGS.enabled;
  const activeModelId =
    typeof r.activeModelId === 'string' ? r.activeModelId : DEFAULT_AI_SETTINGS.activeModelId;
  return { enabled, activeModelId };
}

export async function loadAiSettings(userId: string): Promise<AiSettings> {
  const raw = await kvGet(settingsKey(userId));
  if (!raw) return DEFAULT_AI_SETTINGS;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export async function saveAiSettings(userId: string, patch: Partial<AiSettings>): Promise<void> {
  const next = { ...snapshot, ...patch };
  setAiSettings(next);
  await kvSet(settingsKey(userId), JSON.stringify(next));
}
