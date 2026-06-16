import { createContext, useContext } from 'react';
import type { VariantConfig } from './variants';
import { activeVariant } from './variants';
import type { Capability } from '@drakkar.software/octochat-sdk';

interface BrandContextValue {
  variant: VariantConfig;
  has: (cap: Capability) => boolean;
}

const BrandContext = createContext<BrandContextValue>({
  variant: activeVariant,
  has: (cap) => activeVariant.features.includes(cap),
});

/** Provides the active variant config to the component tree. */
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const value: BrandContextValue = {
    variant: activeVariant,
    has: (cap) => activeVariant.features.includes(cap),
  };
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/** Returns the active variant config and a `has(cap)` helper. */
export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
