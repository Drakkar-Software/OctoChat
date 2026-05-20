import { useColorScheme } from 'react-native';

import { colors, type ColorScheme, type Palette, type Theme } from '@/theme';

/**
 * Resolves the active palette from the OS color scheme.
 *
 * This is the only place the app reads the system scheme; components consume
 * `colors`/`scheme` from here and never import the raw palette directly, so a
 * future manual light/dark toggle only needs to change this hook.
 */
export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: colors[scheme] };
}

export type { Palette, ColorScheme };
