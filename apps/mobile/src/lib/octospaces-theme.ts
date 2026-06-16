/**
 * Maps OctoChat's marine-palette `Palette` to the `Theme` shape expected by
 * `@drakkar.software/octospaces-ui`. The two token systems use different names
 * (OctoChat: canvas/paper/ink; octospaces-ui: background/surface/text) so we
 * project from OctoChat's richer palette into the shared contract here.
 *
 * Call once per scheme change; pass the result to `<OctoSpacesThemeProvider>`.
 */
import type { Theme } from '@drakkar.software/octospaces-ui';
import { type ColorScheme, type Palette, spacing, radii, type as typeScale, fonts, motion, shadows, layout, opacity } from '@/theme';

function toOctoSpacesPalette(p: Palette): Theme['colors'] {
  return {
    background: p.canvas,
    surface: p.paper,
    surfaceElevated: p.paper,
    surfaceModal: p.paper,
    surfaceInput: p.paperAlt,
    sidebar: p.paperAlt,       // rail background (paperAlt in OctoChat — same hue as panel)
    sidebarPanel: p.paperAlt,  // panel shell background (shared Sidebar component reads this)
    sidebarActive: p.accentSoft,

    border: p.lineSoft,
    borderSubtle: p.lineFaint,
    borderStrong: p.line,

    text: p.ink,
    textSecondary: p.inkSoft,
    textTertiary: p.inkMuted,
    textDisabled: p.inkFaint,
    textInverse: p.onScrim,
    textOnPrimary: p.onAccent,

    primary: p.accent,
    primaryHover: p.accentStrong,
    primaryMuted: p.accentBg,
    primarySubtle: p.accentSoft,

    success: p.success,
    successMuted: p.successBg,
    warning: p.warning,
    warningMuted: p.warningBg,
    danger: p.danger,
    dangerMuted: p.dangerBg,
    info: p.info,
    infoMuted: p.infoBg,

    presenceOnline: p.success,
    presenceAway: p.warning,
    presenceBusy: p.danger,
    presenceOffline: p.inkFaint,

    verificationVerified: p.success,
    verificationPartial: p.warning,
    verificationNone: p.inkMuted,

    // Interaction states — new optional fields in octospaces-ui 0.4.5
    pressed: p.pressed,
    selected: p.selected,
    selectedHover: p.selectedHover,
    disabledFill: p.disabledFill,
    focusRing: p.focusRing,

    overlay: p.overlay,
    shadow: shadows.sm.shadowColor,
    focus: p.focusRing,
    skeleton: p.skeleton,
    skeletonShimmer: p.skeletonShimmer,

    editorCanvas: p.editorCanvas,
    tooltipBg: p.tooltipBg,
    onTooltip: p.onTooltip,
  };
}

/** Convert OctoChat spacing (named) to octospaces-ui numeric map. */
const SPACING: Theme['spacing'] = {
  '0': 0,
  '1': spacing.xs,
  '2': spacing.sm,
  '3': spacing.md,
  '4': spacing.lg,
  '6': spacing.xl,
  '8': spacing.xxl,
  '12': spacing.xxxl,
};

const RADII: Theme['radii'] = {
  xs: radii.xs,
  sm: radii.sm,
  md: radii.md,
  lg: radii.lg,
  xl: radii.xl,
  full: radii.pill,
};

const TYPE: Theme['type'] = {
  displayLg: { size: typeScale.displayLg.fontSize, lineHeight: typeScale.displayLg.lineHeight },
  display:   { size: typeScale.display.fontSize,   lineHeight: typeScale.display.lineHeight },
  title:     { size: typeScale.title.fontSize,     lineHeight: typeScale.title.lineHeight },
  heading:   { size: typeScale.heading.fontSize,   lineHeight: typeScale.heading.lineHeight },
  subhead:   { size: typeScale.subhead.fontSize,   lineHeight: typeScale.subhead.lineHeight },
  body:      { size: typeScale.body.fontSize,      lineHeight: typeScale.body.lineHeight },
  callout:   { size: typeScale.callout.fontSize,   lineHeight: typeScale.callout.lineHeight },
  footnote:  { size: typeScale.footnote.fontSize,  lineHeight: typeScale.footnote.lineHeight },
  caption:   { size: typeScale.caption.fontSize,   lineHeight: typeScale.caption.lineHeight },
  micro:     { size: typeScale.micro.fontSize,     lineHeight: typeScale.micro.lineHeight },
};

const FONTS: Theme['fonts'] = {
  display:     fonts.display,
  heading:     fonts.heading,
  body:        fonts.body,
  bodyMedium:  fonts.bodyMedium,
  mono:        fonts.mono,
};

const MOTION: Theme['motion'] = {
  fast:  { duration: motion.fast },
  base:  { duration: motion.base },
  slow:  { duration: motion.slow },
};

const SHADOWS: Theme['shadows'] = {
  none: {},
  sm:   shadows.sm,
  md:   shadows.md,
  lg:   shadows.lg,
};

const LAYOUT: Theme['layout'] = {
  maxContentWidth:    layout.maxContentWidth,
  tabBarHeight:       layout.tabBarHeight,
  headerMinHeight:    layout.headerMinHeight,
  breakpointDesktop:  layout.breakpointDesktop,
  railWidth:          layout.railWidth,
  sidebarWidth:       layout.sidebarWidth,
};

const OPACITY: Theme['opacity'] = {
  disabled: opacity.disabled,
  muted:    opacity.muted,
};

export function toOctoSpacesTheme(palette: Palette, scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: toOctoSpacesPalette(palette),
    spacing: SPACING,
    radii: RADII,
    type: TYPE,
    fonts: FONTS,
    motion: MOTION,
    shadows: SHADOWS,
    layout: LAYOUT,
    opacity: OPACITY,
    swatches: {
      railTile: palette.fill,
      railTileHoverBorder: palette.accentBorder,
      railGlow: palette.glow,
      railTileHoverInk: palette.accentInk,
    },
    layers: { modal: 100, overlay: 50, header: 10 },
    easing: {
      standard:   [...motion.easing.standard],
      decelerate: [...motion.easing.decelerate],
      accelerate: [...motion.easing.accelerate],
    },
    labelTracking: { mono: 0.8, display: -0.6 },
  };
}
