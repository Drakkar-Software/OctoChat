import type { ColorSchemeName } from 'react-native';

/**
 * The small set of cross-cutting values `@octochat/ui` native primitives need to
 * reach the underlying platform UI toolkit (SwiftUI tint / Material 3 seed /
 * inline styles). A package can't import the app's `src/theme.ts`, so the app
 * bridges these tokens in at boot via `OctoUIThemeProvider` — `src/theme.ts`
 * stays the single source of truth.
 */
export interface OctoUITheme {
  /** `'light'` / `'dark'` forces native controls to match the app theme;
   *  `'unspecified'` follows the device setting. */
  scheme: ColorSchemeName;
  colors: {
    /** Marine accent — Host `seedColor` (SwiftUI tint / Material seed) for the
     *  default tone: tints switches, segmented controls, sliders, buttons. */
    accent: string;
    /** Amber OctoDesk accent — used when a primitive is passed `tone="desk"`. */
    accentDesk: string;
    /** Label color for text drawn on a solid accent fill (native Button label). */
    onAccent: string;
    /** Destructive tint for danger actions (menu items, buttons). */
    danger: string;
    /** Sheet / grouped-surface background so native sheets match the paper look. */
    surface: string;
  };
}
