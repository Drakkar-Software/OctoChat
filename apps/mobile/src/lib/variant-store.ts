/**
 * Device-level variant preference — persisted to the platform KV store so the
 * user's choice survives app restarts. No userId prefix: this is a per-install
 * setting, not per-identity.
 *
 * Module-level snapshot + listener pattern (mirrors ai/notification-settings).
 * Seeds from ACTIVE_VARIANT (the build-time env var) so the first render before
 * KV loads gets the right value without a flash.
 */
import { kvGet, kvSet } from '@drakkar.software/octochat-sdk';

import { ACTIVE_VARIANT, VARIANTS, type VariantId } from './variants';

const KV_KEY = 'octochat.variant';

let snapshot: VariantId = ACTIVE_VARIANT;
const listeners = new Set<() => void>();

export function getActiveVariantId(): VariantId {
  return snapshot;
}

export function subscribeVariant(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setActiveVariantId(id: VariantId): void {
  snapshot = id;
  for (const l of listeners) l();
}

export async function loadVariantId(): Promise<VariantId> {
  const raw = await kvGet(KV_KEY);
  if (raw != null && raw in VARIANTS) return raw as VariantId;
  return ACTIVE_VARIANT;
}

export async function saveVariantId(id: VariantId): Promise<void> {
  setActiveVariantId(id);
  await kvSet(KV_KEY, id);
}
