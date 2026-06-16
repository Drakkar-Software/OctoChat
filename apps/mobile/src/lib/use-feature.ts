import type { Capability } from '@drakkar.software/octochat-sdk';
import { useBrand } from './brand-context';

/** Returns true when the active variant has the given capability enabled. */
export function useFeature(cap: Capability): boolean {
  return useBrand().has(cap);
}
