/**
 * Built-in provider catalog. Adding a new provider: drop a `<id>.ts` next to this
 * file (exporting an `AutomationProvider`), import it here, and append it to
 * `PROVIDERS`. The id is the FK from `Room.automation.providerId` — never rename.
 */
import type { AutomationProvider } from '../types';

import { echoProvider } from './echo';
import { httpProvider } from './http';
import { rssProvider } from './rss';

// Each concrete provider is parameterized over its own params shape, so a
// catalog cell is widened to `AutomationProvider<any>` at the type level — the
// caller still gets typed access via `getProvider(id)` returning the union and
// the provider's own implementation enforces its real param shape internally.
type AnyProvider = AutomationProvider<any>;

export const PROVIDERS: AnyProvider[] = [rssProvider, httpProvider, echoProvider];

/** Resolve a provider by id, or `null` for an unknown id (a registry entry might
 *  pin an id that no longer ships — the runner skips it; the UI shows "Unknown
 *  provider" rather than crashing). */
export function getProvider(id: string): AnyProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
