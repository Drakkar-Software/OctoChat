import React, { createContext, useContext } from 'react';
import { Host } from '@expo/ui';
import type { UniversalHostProps } from '@expo/ui';

import { useOctoUITheme } from '../../theme/context';
import type { OctoUITheme } from '../../theme/types';

const HostContext = createContext(false);

export interface ForgeHostProps extends UniversalHostProps {
  children: React.ReactNode;
}

/**
 * Themed `@expo/ui` Host — `seedColor` defaults to the marine `accent` so nested
 * native controls (Switch / Button / Segmented / Slider / Picker) inherit the
 * app's accent on iOS (SwiftUI tint) / Android (Material 3 palette) / web (CSS
 * vars). `colorScheme` follows the app theme so native chrome matches light/dark.
 * Marks descendants via `HostContext` so nested native primitives render bare
 * instead of each creating their own bridge.
 */
export function ForgeHost({ children, seedColor, colorScheme, ...rest }: ForgeHostProps) {
  const theme = useOctoUITheme();
  return (
    <Host
      seedColor={seedColor ?? theme.colors.accent}
      colorScheme={colorScheme ?? theme.scheme}
      {...rest}
    >
      <HostContext.Provider value={true}>{children}</HostContext.Provider>
    </Host>
  );
}

/**
 * Wraps `node` in a `ForgeHost` unless it is already inside one — collapses a
 * tree of self-hosting native primitives down to a single native bridge.
 * `hostProps` (e.g. `matchContents`, `seedColor`) is applied only when this call
 * creates the Host; it is ignored when collapsing into an ancestor's, since a
 * Host's sizing/theme is fixed at mount.
 */
export function useHostWrap(
  node: React.ReactElement,
  hostProps?: Partial<ForgeHostProps>,
): React.ReactElement {
  const insideHost = useContext(HostContext);
  return insideHost ? node : <ForgeHost {...hostProps}>{node}</ForgeHost>;
}

/** Resolve the Host `seedColor` for a primitive's `tone` (marine vs OctoDesk amber). */
export function hostSeed(theme: OctoUITheme, tone?: 'default' | 'desk'): string {
  return tone === 'desk' ? theme.colors.accentDesk : theme.colors.accent;
}

export { HostContext };
