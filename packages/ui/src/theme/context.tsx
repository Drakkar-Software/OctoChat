import React, { createContext, useContext } from 'react';

import type { OctoUITheme } from './types';

/**
 * Neutral fallback so a primitive rendered outside a provider still works — the
 * app always mounts `OctoUIThemeProvider` at the root with the live marine tokens.
 */
const defaultTheme: OctoUITheme = {
  scheme: 'unspecified',
  colors: {
    accent: '#0e7090',
    accentDesk: '#b7791f',
    onAccent: '#ffffff',
    danger: '#c0392b',
    surface: '#ffffff',
  },
};

const OctoUIThemeContext = createContext<OctoUITheme>(defaultTheme);

interface OctoUIThemeProviderProps {
  theme?: {
    scheme?: OctoUITheme['scheme'];
    colors?: Partial<OctoUITheme['colors']>;
  };
  children: React.ReactNode;
}

/**
 * Bridges the app's `src/theme.ts` tokens into `@octochat/ui`. Mount at the root
 * of the provider stack (below the app theme/brand providers so the active
 * scheme + accent are available), feeding `useTheme().colors`.
 */
export function OctoUIThemeProvider({ theme, children }: OctoUIThemeProviderProps) {
  const merged: OctoUITheme = {
    scheme: theme?.scheme ?? defaultTheme.scheme,
    colors: { ...defaultTheme.colors, ...theme?.colors },
  };
  return <OctoUIThemeContext.Provider value={merged}>{children}</OctoUIThemeContext.Provider>;
}

export function useOctoUITheme(): OctoUITheme {
  return useContext(OctoUIThemeContext);
}
