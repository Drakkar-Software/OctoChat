import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import type { Capability } from '@drakkar.software/octochat-sdk';

import type { VariantConfig, VariantId } from './variants';
import { VARIANTS } from './variants';
import {
  getActiveVariantId,
  loadVariantId,
  saveVariantId,
  setActiveVariantId,
  subscribeVariant,
} from './variant-store';

interface BrandContextValue {
  variant: VariantConfig;
  has: (cap: Capability) => boolean;
  setVariant: (id: VariantId) => Promise<void>;
}

const BrandContext = createContext<BrandContextValue>({
  variant: VARIANTS[getActiveVariantId()],
  has: (cap) => VARIANTS[getActiveVariantId()].features.includes(cap),
  setVariant: saveVariantId,
});

/** Provides the active variant config to the component tree. Loads the
 *  persisted choice from KV on mount so the user's preference survives restarts. */
export function BrandProvider({ children }: { children: ReactNode }) {
  const variantId = useSyncExternalStore(subscribeVariant, getActiveVariantId, getActiveVariantId);
  const variant = VARIANTS[variantId];

  useEffect(() => {
    void loadVariantId().then((id) => {
      if (id !== getActiveVariantId()) setActiveVariantId(id);
    });
  }, []);

  const has = useCallback((cap: Capability) => variant.features.includes(cap), [variant]);
  const value = useMemo<BrandContextValue>(
    () => ({ variant, has, setVariant: saveVariantId }),
    [variant, has],
  );
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/** Returns the active variant config, a `has(cap)` helper, and `setVariant`. */
export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
