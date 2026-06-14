import { SpaceSwitcher } from './SpaceSwitcher';

/**
 * Drop-in {@link SpaceSwitcher} wrapper for the native nav-stack `headerLeft`.
 * The switcher is now self-contained — no prop wiring needed. This file exists
 * as a stable import target for {@link SpaceStackLayout}.
 */
export function SpaceSwitcherButton() {
  return <SpaceSwitcher />;
}
