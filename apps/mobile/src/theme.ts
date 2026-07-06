/**
 * OctoChat design tokens — the SINGLE source of truth for the whole app.
 *
 * Every color, font, size, radius, shadow and motion value lives here.
 * Components must NEVER hardcode a hex / size or compute `rgba()` inline —
 * import from this file (usually via `useTheme()` in `src/lib/use-theme.ts`)
 * so light/dark stay in sync and the marine "paper-on-subaqua" identity holds.
 *
 * Palette is anchored to the exported OctoChat wireframe tokens (marine accent
 * #0e7090 light / #52b6d4 dark, paper/canvas/ink hierarchy). Following the
 * house style, alpha variants are pre-derived into named tokens (accentBg,
 * accentBorder, surface, rule…) rather than mixed at call sites.
 */
// Presentation enums whose canonical home is the headless SDK domain model; imported
// here so the theme's color helpers stay the single mapping to palette tokens.
import type { PresenceStatus, VerificationLevel } from '@drakkar.software/octochat-sdk';
export type { PresenceStatus, VerificationLevel };

export type ColorScheme = 'light' | 'dark';

export interface Palette {
  // ── Surfaces ────────────────────────────────────────────────────────────
  /** App backdrop, behind everything. */
  canvas: string;
  /** Subtle gradient stops giving the canvas subaquatic depth. */
  depthTop: string;
  depthBottom: string;
  /** Raised surfaces (cards, sheets, headers). */
  paper: string;
  /** Slightly recessed surface (inputs, inset wells). */
  paperAlt: string;
  /** Neutral solid fills (avatars, chips, skeletons). */
  fill: string;
  fillDeep: string;
  /** Translucent ink overlays for layering on top of varied surfaces. */
  surface: string;
  surfaceStrong: string;
  /** Recessed fill + hairline for inline/fenced code in chat messages. */
  codeBg: string;
  codeBorder: string;

  // ── Ink (text + icons), strongest → faintest ─────────────────────────────
  ink: string;
  inkSoft: string;
  inkMuted: string;
  inkFaint: string;

  // ── Lines & dividers ─────────────────────────────────────────────────────
  /** Solid hairlines on paper, strongest → faintest. */
  line: string;
  lineSoft: string;
  lineFaint: string;
  /** Translucent dividers for use over arbitrary backgrounds. */
  rule: string;
  ruleSoft: string;
  /** "Lit from above" top-edge highlight on raised surfaces (the inner light
   *  that gives cards/sheets depth — dark mode's stand-in for a drop shadow). */
  hairlineHi: string;

  // ── Interaction states ────────────────────────────────────────────────────
  /** Translucent fill painted under a hovered control/row. */
  hover: string;
  /** Hover wash for already-selected (accentSoft) rows. */
  accentSoftHover: string;
  /** White brightening wash layered over a solid/gradient fill on hover. */
  brightWash: string;
  /** Translucent fill on an actively pressed control. */
  pressed: string;
  /** Solid accent-tinted fill for a selected row/item (aliases accentSoft). */
  selected: string;
  /** Hover state within an already-selected row. */
  selectedHover: string;
  /** Neutral fill for a disabled control's background (pairs with opacity.disabled). */
  disabledFill: string;
  /** Keyboard-focus ring color (WCAG-compliant accent, for web :focus-visible). */
  focusRing: string;

  // ── Marine accent system ─────────────────────────────────────────────────
  accent: string;
  accentStrong: string;
  /** Gradient stops for primary fills (buttons, send, brand disc): top → bottom. */
  accentGradTop: string;
  accentGradBottom: string;
  /** Bioluminescent glow color — drives accent glows that read in both schemes. */
  glow: string;
  /** Solid soft accent (selected rows, highlight blocks). */
  accentSoft: string;
  /** Readable accent-tinted ink (text on accentSoft). */
  accentInk: string;
  /** Readable text/icon when sitting directly on `accent`. */
  onAccent: string;
  /** Translucent accent fills/borders. */
  accentBg: string;
  accentBgStrong: string;
  accentBorder: string;
  accentBorderStrong: string;

  // ── Desk accent (OctoDesk variant — full parity with marine) ────────────
  /** Support/amber accent for the OctoDesk variant. */
  accentDesk: string;
  accentDeskSoft: string;
  accentDeskBg: string;
  accentDeskBorder: string;
  accentDeskStrong: string;
  accentDeskInk: string;
  accentDeskGradTop: string;
  accentDeskGradBottom: string;
  accentDeskGlow: string;

  // ── Status ───────────────────────────────────────────────────────────────
  unread: string;
  mention: string;
  /** Text/glyph on an `unread`/`mention` badge — stays light in both schemes. */
  onUnread: string;
  danger: string;
  dangerBg: string;
  dangerBorder: string;
  success: string;
  successBg: string;
  successBorder: string;
  warning: string;
  warningBg: string;
  warningBorder: string;

  // ── Sticky-note (sparingly, e.g. security callouts) ──────────────────────
  // ── Info status (informational — currently aliases accent, promoted here so
  //    the bridge and components can use a distinct token when designs diverge) ──
  info: string;
  infoBg: string;
  infoBorder: string;
  // ── Neutral (non-semantic chips, muted tags, draft labels) ───────────────
  neutral: string;
  neutralBg: string;
  neutralBorder: string;

  note: string;
  noteInk: string;

  // ── Overlays ─────────────────────────────────────────────────────────────
  /** Full-bleed scrim behind modals / camera overlays. */
  scrim: string;
  overlay: string;
  /** Foreground (icons/text) drawn on top of `scrim` — light in both themes. */
  onScrim: string;

  // ── Loading / skeleton ────────────────────────────────────────────────────
  skeleton: string;
  skeletonShimmer: string;

  // ── dk-spaces-ui extras ────────────────────────────────────────────────────
  /** Background of the rich-text editor canvas (doc/work surfaces). */
  editorCanvas: string;
  /** Background of floating tooltips. */
  tooltipBg: string;
  /** Foreground (text/icons) drawn on `tooltipBg`. */
  onTooltip: string;
}

const light: Palette = {
  canvas: '#e9eef2',
  depthTop: '#f4f8fb',
  depthBottom: '#dce7ee',
  paper: '#ffffff',
  paperAlt: '#f6f8fa',
  fill: '#e5edf2',
  fillDeep: '#d2dfe6',
  surface: 'rgba(20,38,52,0.04)',
  surfaceStrong: 'rgba(20,38,52,0.08)',
  codeBg: 'rgba(20,38,52,0.06)',
  codeBorder: 'rgba(20,38,52,0.12)',

  ink: '#142634',
  inkSoft: '#3d566c',
  inkMuted: '#7d96a8',
  inkFaint: '#b9cad5',

  line: '#3a5567',
  lineSoft: '#c8d6de',
  lineFaint: '#dde6ec',
  rule: 'rgba(20,38,52,0.10)',
  ruleSoft: 'rgba(20,38,52,0.06)',
  hairlineHi: 'rgba(255,255,255,0.85)',

  hover: 'rgba(20,38,52,0.05)',
  accentSoftHover: 'rgba(14,112,144,0.18)',
  brightWash: 'rgba(255,255,255,0.12)',
  pressed: 'rgba(20,38,52,0.08)',
  selected: '#bbdce6',
  selectedHover: 'rgba(14,112,144,0.18)',
  disabledFill: 'rgba(20,38,52,0.04)',
  focusRing: '#0e7090',

  accent: '#0e7090',
  accentStrong: '#0a5a74',
  accentGradTop: '#1a90b3',
  accentGradBottom: '#0a5a74',
  glow: '#0e7090',
  accentSoft: '#bbdce6',
  accentInk: '#063848',
  onAccent: '#ffffff',
  accentBg: 'rgba(14,112,144,0.10)',
  accentBgStrong: 'rgba(14,112,144,0.16)',
  accentBorder: 'rgba(14,112,144,0.32)',
  accentBorderStrong: 'rgba(14,112,144,0.50)',
  accentDesk: '#8b5a2b',
  accentDeskSoft: '#e8d5c0',
  accentDeskBg: 'rgba(139,90,43,0.10)',
  accentDeskBorder: 'rgba(139,90,43,0.32)',
  accentDeskStrong: '#6f4520',
  accentDeskInk: '#3d2010',
  accentDeskGradTop: '#a36830',
  accentDeskGradBottom: '#6f4520',
  accentDeskGlow: '#8b5a2b',

  unread: '#0c8aaf',
  mention: '#a64034',
  onUnread: '#ffffff',
  danger: '#a64034',
  dangerBg: 'rgba(166,64,52,0.10)',
  dangerBorder: 'rgba(166,64,52,0.32)',
  success: '#1f8a70',
  successBg: 'rgba(31,138,112,0.12)',
  successBorder: 'rgba(31,138,112,0.35)',
  warning: '#b07a1e',
  warningBg: 'rgba(176,122,30,0.12)',
  warningBorder: 'rgba(176,122,30,0.32)',

  info: '#0e7090',
  infoBg: 'rgba(14,112,144,0.10)',
  infoBorder: 'rgba(14,112,144,0.32)',
  neutral: '#7d96a8',
  neutralBg: 'rgba(20,38,52,0.06)',
  neutralBorder: 'rgba(20,38,52,0.14)',

  note: '#fff2b0',
  noteInk: '#4a3a10',

  scrim: 'rgba(20,38,52,0.55)',
  overlay: 'rgba(20,38,52,0.35)',
  onScrim: '#f4f8fb',

  skeleton: '#e5edf2',
  skeletonShimmer: '#d2dfe6',

  editorCanvas: '#f6f8fa',
  tooltipBg: '#142634',
  onTooltip: '#f4f8fb',
};

const dark: Palette = {
  canvas: '#0b151c',
  depthTop: '#13303f',
  depthBottom: '#060d12',
  paper: '#16252f',
  paperAlt: '#1c2f3b',
  fill: '#1f3240',
  fillDeep: '#283f4f',
  surface: 'rgba(216,230,238,0.05)',
  surfaceStrong: 'rgba(216,230,238,0.09)',
  codeBg: 'rgba(216,230,238,0.07)',
  codeBorder: 'rgba(216,230,238,0.14)',

  ink: '#d8e6ee',
  inkSoft: '#a9bdc9',
  inkMuted: '#6f8696',
  inkFaint: '#3c5060',

  line: '#5b7587',
  lineSoft: '#2e4253',
  lineFaint: '#22323e',
  rule: 'rgba(216,230,238,0.10)',
  ruleSoft: 'rgba(216,230,238,0.06)',
  hairlineHi: 'rgba(190,228,238,0.10)',

  hover: 'rgba(216,230,238,0.055)',
  accentSoftHover: 'rgba(82,182,212,0.16)',
  brightWash: 'rgba(255,255,255,0.12)',
  pressed: 'rgba(216,230,238,0.10)',
  selected: '#264a58',
  selectedHover: 'rgba(82,182,212,0.16)',
  disabledFill: 'rgba(216,230,238,0.05)',
  focusRing: '#52b6d4',

  accent: '#52b6d4',
  accentStrong: '#6cc6e0',
  accentGradTop: '#6fcce6',
  accentGradBottom: '#3f9fc0',
  glow: '#52b6d4',
  accentSoft: '#264a58',
  accentInk: '#bfe4ee',
  onAccent: '#052029',
  accentBg: 'rgba(82,182,212,0.12)',
  accentBgStrong: 'rgba(82,182,212,0.20)',
  accentBorder: 'rgba(82,182,212,0.35)',
  accentBorderStrong: 'rgba(82,182,212,0.55)',
  accentDesk: '#d4956a',
  accentDeskSoft: '#3a2415',
  accentDeskBg: 'rgba(212,149,106,0.12)',
  accentDeskBorder: 'rgba(212,149,106,0.35)',
  accentDeskStrong: '#b07040',
  accentDeskInk: '#e8c098',
  accentDeskGradTop: '#d4a870',
  accentDeskGradBottom: '#b07040',
  accentDeskGlow: '#d4956a',

  unread: '#52b6d4',
  mention: '#cf6b5e',
  onUnread: '#ffffff',
  danger: '#cf6b5e',
  dangerBg: 'rgba(207,107,94,0.14)',
  dangerBorder: 'rgba(207,107,94,0.38)',
  success: '#5fc8a8',
  successBg: 'rgba(95,200,168,0.14)',
  successBorder: 'rgba(95,200,168,0.36)',
  warning: '#d6a23f',
  warningBg: 'rgba(214,162,63,0.14)',
  warningBorder: 'rgba(214,162,63,0.34)',

  info: '#52b6d4',
  infoBg: 'rgba(82,182,212,0.12)',
  infoBorder: 'rgba(82,182,212,0.35)',
  neutral: '#6f8696',
  neutralBg: 'rgba(216,230,238,0.07)',
  neutralBorder: 'rgba(216,230,238,0.14)',

  note: '#3a3416',
  noteInk: '#e9d98a',

  scrim: 'rgba(4,10,15,0.66)',
  overlay: 'rgba(4,10,15,0.45)',
  onScrim: '#f4f8fb',

  skeleton: '#1f3240',
  skeletonShimmer: '#283f4f',

  editorCanvas: '#0f1e27',
  tooltipBg: '#d8e6ee',
  onTooltip: '#0b151c',
};

export const colors: Record<ColorScheme, Palette> = { light, dark };

/**
 * Font family keys — MUST match the keys registered in
 * `src/lib/use-app-fonts.ts`. Named by role, not weight, so call sites read
 * clearly. (RN custom fonts ship one family per weight, hence explicit names.)
 */
export const fonts = {
  /** Bricolage Grotesque — characterful display for wordmark & big titles. */
  display: 'BricolageGrotesque_800ExtraBold',
  heading: 'BricolageGrotesque_700Bold',
  /** Hanken Grotesk — clean, friendly UI body text. */
  body: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodySemibold: 'HankenGrotesk_600SemiBold',
  bodyBold: 'HankenGrotesk_700Bold',
  /** JetBrains Mono — keys, fingerprints, seed words, timestamps, labels. */
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/** Type scale: [fontSize, lineHeight]. */
export const type = {
  /** Hero display — true page-defining moment (front door, identity hero). */
  displayLg: { fontSize: 40, lineHeight: 44 },
  display: { fontSize: 28, lineHeight: 34 },
  title: { fontSize: 22, lineHeight: 28 },
  heading: { fontSize: 17, lineHeight: 22 },
  subhead: { fontSize: 15, lineHeight: 22 },
  body: { fontSize: 15, lineHeight: 22 },
  callout: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
  caption: { fontSize: 11, lineHeight: 14 },
  micro: { fontSize: 10, lineHeight: 13 },
} as const;

/** Uppercase mono labels share this tracking ("ENTER PIN", "SECURITY"…). */
export const labelTracking = 0.8;

/** Tight tracking for the large display step — big Bricolage reads better pulled in. */
export const displayTracking = -0.6;

/** Slightly tight tracking for the `display` variant (28px) — intermediate tightening. */
export const headingTracking = -0.4;

/** 4px spacing scale + semantic aliases. */
export const spacing = {
  none: 0,
  /** Sub-scale hairline gap — for tight label-over-value pairs. Below the 4px grid. */
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  /** Default horizontal screen padding. */
  screenX: 18,
  /** Standard gap between stacked controls/cards. */
  gutter: 12,
  /** Minimum tappable control height. */
  controlMinHeight: 48,
  /** Vertical padding for a compact list row (channels, DMs). */
  rowY: 9,
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  card: 14,
  sheet: 22,
  pill: 999,
} as const;

/** Border-width scale — use instead of inline `borderWidth` literals. */
export const borders = {
  /** Sub-pixel hairline rule (closest to 0.5px across densities). */
  hairline: 0.5,
  /** Standard divider, outline, chip border. */
  thin: 1,
  /** Emphasized border — active input ring, selection indicator, focus ring. */
  thick: 1.5,
} as const;

/** Width (in px) of the keyboard-focus ring applied to interactive controls. */
export const focusWidth = 2;

/** Cross-platform elevation presets (react-native-web maps these to boxShadow). */
export const shadows = {
  none: {},
  sm: {
    shadowColor: '#0a1722',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0a1722',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  lg: {
    shadowColor: '#0a1722',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  /** Bioluminescent accent glow for hero/primary moments. */
  accentGlow: {
    shadowColor: '#0e7090',
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

/**
 * Accent-tinted glow keyed to the active scheme's `glow` color. Dark surfaces
 * swallow near-black drop shadows, so primary moments (buttons, send, the brand
 * disc, focused inputs) lean on a colored bloom instead. Pass `colors.glow`.
 */
export function glowShadow(color: string, opacity = 0.45, radius = 18) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  } as const;
}

/**
 * The "lit-from-above paper edge" — a `paper` surface ringed by a hairline whose
 * top edge catches light (`hairlineHi`). Returns the three theme-dependent color
 * props meant for an inline style; pair with a `borderWidth`/`borderRadius` from a
 * StyleSheet. Pass a `border` override for emphasised edges (e.g. `accentBorder`).
 */
export function paperBorder(p: Palette, border: string = p.lineSoft) {
  return {
    backgroundColor: p.paper,
    borderColor: border,
    borderTopColor: p.hairlineHi,
  } as const;
}

/**
 * A single step of the depth-based elevation system.
 * "More elevated = more light" — surfaces closer to the viewer catch more of the
 * bioluminescent bloom that stands in for drop shadows in the marine theme.
 */
export interface ElevationLevel {
  /** Surface background color. */
  surface: string;
  /** Perimeter border color (all sides except top). */
  border: string;
  /** Top-edge "lit-from-above" hairline — omit on deeply recessed surfaces. */
  topHairline: string;
  /** Shadow preset from `shadows` for this level (none on flat levels). */
  shadow: (typeof shadows)[keyof typeof shadows];
}

export type ElevationScale = {
  /** Canvas — the deepest level; no lift, no shadow. */
  e0: ElevationLevel;
  /** Recessed wells — inputs, inset code blocks, inset panels. */
  e1: ElevationLevel;
  /** Raised rows and cards — the standard "paper" surface. */
  e2: ElevationLevel;
  /** Floating controls — popovers, hovercards, action clusters. */
  e3: ElevationLevel;
  /** Modals and sheets — the highest interactive layer. */
  e4: ElevationLevel;
};

/**
 * Return the full elevation scale for the active palette. Call once inside a
 * component alongside `useTheme()`:
 *
 * ```tsx
 * const { colors } = useTheme();
 * const elev = getElevation(colors);
 * // style={{ backgroundColor: elev.e3.surface, ...elev.e3.shadow }}
 * ```
 *
 * Replace ad-hoc uses of `paperBorder(colors)` + `shadows.sm/md` with the
 * appropriate level so every floating surface picks the same shadow + hairline.
 */
export function getElevation(p: Palette): ElevationScale {
  return {
    e0: { surface: p.canvas,   border: p.rule,      topHairline: 'transparent', shadow: shadows.none },
    e1: { surface: p.paperAlt, border: p.lineFaint,  topHairline: 'transparent', shadow: shadows.none },
    e2: { surface: p.paper,    border: p.lineSoft,   topHairline: p.hairlineHi,  shadow: shadows.none },
    e3: { surface: p.paper,    border: p.lineSoft,   topHairline: p.hairlineHi,  shadow: shadows.sm   },
    e4: { surface: p.paper,    border: p.lineSoft,   topHairline: p.hairlineHi,  shadow: shadows.md   },
  };
}

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
  /** Keypad fade-out / tip fade-in while a slow unlock (Argon2id) stretches the PIN. */
  unlockFade: 2000,
  /** Slow ambient loop — bioluminescent halo / breathing glow. */
  pulse: 2800,
  /** Skeleton shimmer loop. */
  shimmer: 1100,
  /** Idle delay before an inline edit autosaves into a merge-doc (cheap in-place
   *  overwrite — short, near-keystroke). */
  autosaveDoc: 600,
  /** Idle delay before an inline edit autosaves into an append-log (each commit is
   *  a permanent entry — longer so transient keystrokes don't bloat the log; blur/
   *  unmount is the primary trigger). */
  autosaveLog: 1500,
  /** Spring config for press / drag interactions (Reanimated). */
  spring: { damping: 18, stiffness: 220, mass: 0.8 },
  /** Orchestrated page-load reveals (StaggerList): `base` head delay + per-index
   *  `step`. Keep small — one staggered entrance, never per-scroll jitter. */
  stagger: { base: 0, step: 45 },
  /**
   * Named cubic-bezier easing curves as [x1, y1, x2, y2]. Use with Reanimated
   * `withTiming({ easing: Easing.bezier(...motion.easing.standard) })`.
   * Mirrors the dk-spaces-ui Theme.easing contract.
   */
  easing: {
    /** General UI motion — accelerates out of rest, decelerates into target. */
    standard:    [0.4, 0, 0.2, 1] as const,
    /** Element entering the screen — starts fast, eases in. */
    decelerate:  [0, 0, 0.2, 1]   as const,
    /** Element leaving the screen — starts slow, ends fast. */
    accelerate:  [0.4, 0, 1, 1]   as const,
  },
} as const;

export const opacity = {
  /** Dimmed pressable/control while disabled or blocked by an async action. */
  disabled: 0.45,
  /** De-emphasized content that is still present (e.g. a completed/struck task). */
  muted: 0.6,
} as const;

export const layout = {
  /** Cap reading width on large/web screens. */
  maxContentWidth: 720,
  /** Composer send disc diameter — the app's hero send control (>= a comfy tap). */
  composerSendSize: 40,
  /** Max width of an EmptyState's copy column so subtitles wrap to a tidy block. */
  emptyStateMaxWidth: 320,
  /** Min-height floor for an empty-state slot in a ScrollView so the centered
   *  icon/title/action group is visible without scrolling. */
  emptyStateFloor: 300,
  /** Diameter of the camera badge overlaid on an editable avatar. */
  avatarBadge: 24,
  /** Max width of an inline chat image attachment (aspect-preserved within it). */
  chatImageMaxWidth: 260,
  tabBarHeight: 64,
  headerMinHeight: 52,
  /** Bottom clearance for scroll content that sits under the floating tab bar +
   *  home-indicator — tabBarHeight (64) + spacing.xxl (32). Use instead of the
   *  magic literal `96` so the value is adjustable in one place. */
  tabBarSafeBottom: 96,
  /** Diameter of a space/profile hero avatar. */
  heroAvatar: 80,
  /** Scale factor for the concentric "bioluminescent ring" behind the hero avatar.
   *  Ring diameter = heroAvatar × heroRingScale; radius = half that. */
  heroRingScale: 1.75,
  /** Size of the OctoChat mark on the onboarding key-derivation screen. */
  onboardingMark: 96,
  /** At/above this viewport width (web) the app switches to the desktop shell. */
  breakpointDesktop: 900,
  /** Vertical spaces rail at the left edge of the desktop shell. */
  railWidth: 64,
  /** Categorized room sidebar between the rail and the main pane. */
  sidebarWidth: 240,
  /** Fixed width of a kanban column on the Projects placeholder board. */
  boardColumnWidth: 236,
  /** Object tree (sidebar + Work): per-depth indent step and disclosure row height. */
  objectTreeIndent: 16,
  objectTreeRowHeight: 34,
  /** Emoji glyph size in a Work doc/project hero header (larger than the title text). */
  objectHeroEmoji: 34,
  /** Min height of the seamless doc editor surface (one borderless textarea over the
   *  whole doc) — generous so an empty/short doc still fills the page as a tap target,
   *  the way a Notion page does; the field auto-grows past this with content. */
  docEditorMinHeight: 320,
  /** Min height of the multiline content field in the task detail sheet. */
  taskContentMinHeight: 120,
  /** Top toolbar above the main pane on desktop. */
  desktopTopbarHeight: 52,
  /**
   * Draggable title strip reserved at the top of the macOS desktop shell so the
   * window's traffic-light buttons (hiddenInset titleBarStyle) don't overlap the
   * app's own chrome. macOS-only; Windows/Linux use a native title bar.
   */
  desktopTitlebarInset: 28,
} as const;

// ── Semantic helpers ───────────────────────────────────────────────────────
// Map domain state → token, so screens stay declarative. Each takes the active
// Palette (from useTheme) since OctoChat is light/dark aware.


export function presenceColor(p: Palette, status: PresenceStatus): string {
  switch (status) {
    case 'online':
      return p.success;
    case 'away':
      return p.warning;
    case 'dnd':
      return p.danger;
    case 'offline':
      return p.inkFaint;
  }
}


/**
 * Deterministic monogram tint (background + readable ink) keyed off a stable id,
 * so image-less avatars are distinguishable instead of a wall of identical grey
 * discs. Kept marine-adjacent (accent + the muted status hues) so it reads as
 * sharp accent punctuation, never a rainbow.
 */
export function avatarTint(p: Palette, key: string): { bg: string; fg: string } {
  const tints = [
    { bg: p.accentSoft, fg: p.accentInk },
    { bg: p.successBg, fg: p.success },
    { bg: p.warningBg, fg: p.warning },
    { bg: p.dangerBg, fg: p.danger },
    { bg: p.accentBgStrong, fg: p.accentInk },
  ] as const;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return tints[h % tints.length];
}


export function verificationColor(p: Palette, level: VerificationLevel): string {
  switch (level) {
    case 'verified':
      return p.success;
    case 'pending':
      return p.warning;
    case 'unverified':
      return p.danger;
    default:
      return p.inkSoft;
  }
}

export type Theme = {
  scheme: ColorScheme;
  colors: Palette;
};
