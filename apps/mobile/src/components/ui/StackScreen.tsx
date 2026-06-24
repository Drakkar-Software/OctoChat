import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout } from '@/theme';
import { useInShell } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';

import { DepthBackdrop } from './DepthBackdrop';

// `KeyboardAvoidingView` from react-native-keyboard-controller is a drop-in for
// RN's KAV that, unlike the stock one, works under Android edge-to-edge (the RN
// 0.85 default). On web it's a passthrough; in the desktop shell the keyboard
// never overlays the composer, so we use a plain `<View>` there too.
const KAV = Platform.OS === 'web' ? View : KeyboardAvoidingView;

interface StackScreenProps {
  /** Header node (usually <AppBar/>); its safe-area inset is painted paper. */
  header?: ReactNode;
  /** Replaces `header` inside the desktop shell (e.g. a <DesktopChatTopbar/>). */
  desktopHeader?: ReactNode;
  /** Pinned footer node (usually <Composer/> or a CTA). */
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  background?: 'canvas' | 'paper';
  contentStyle?: StyleProp<ViewStyle>;
  /** When inside the tab navigator, the tab bar owns the bottom inset. */
  inTabs?: boolean;
  /** Mobile-only: let the header slide away on scroll-down and return on
   *  scroll-up (requires `scroll`). Ignored in the desktop shell. */
  collapsibleHeader?: boolean;
  /** Native-only: a real navigation-stack header sits above this screen, so it
   *  owns the top safe-area inset. Skip the in-screen header + top SafeAreaView so
   *  the body starts flush under the native bar (no doubled inset). */
  headerProvidedNatively?: boolean;
}

/**
 * Header + content + footer scaffold over the marine canvas, with safe-area
 * insets handled and content width-capped for web. Keeps route pages thin.
 */
export function StackScreen({
  header,
  desktopHeader,
  footer,
  children,
  scroll = false,
  background = 'canvas',
  contentStyle,
  inTabs = false,
  collapsibleHeader = false,
  headerProvidedNatively = false,
}: StackScreenProps) {
  const { colors } = useTheme();
  const inShell = useInShell();
  const insets = useSafeAreaInsets();
  const bg = background === 'paper' ? colors.paper : colors.canvas;
  const headerNode = inShell ? (desktopHeader ?? header) : header;

  // Hide-on-scroll plumbing. Hooks run unconditionally (rules of hooks); only the
  // collapsible branch below consumes them, so the default path is unaffected.
  const collapsible = collapsibleHeader && scroll && !inShell && !!headerNode;
  const [headerH, setHeaderH] = useState(layout.headerMinHeight + insets.top); // seeded so paddingTop doesn't jump
  const headerY = useSharedValue(0);
  const lastY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        const y = e.contentOffset.y;
        const dy = y - lastY.get();
        lastY.set(y);
        // Near the top the header is always shown (no blank strip); below that,
        // accumulate scroll delta clamped to [-headerH, 0].
        headerY.set(y <= headerH ? 0 : Math.min(0, Math.max(-headerH, headerY.get() - dy)));
      },
    },
    [headerH],
  );
  const headerAnim = useAnimatedStyle(() => ({ transform: [{ translateY: headerY.get() }] }));

  // The footer (Composer) bottom inset collapses as the keyboard opens. The KAV
  // (behavior="padding") pins the footer's bottom edge to the keyboard top, so a
  // static home-indicator inset would sit there as an empty band between the
  // composer and the keyboard. Interpolate insets.bottom → 0 with the keyboard so
  // the composer rests snug above it; restores the full inset when it closes.
  const keyboard = useReanimatedKeyboardAnimation();
  const footerBottomInset = useAnimatedStyle(() => ({
    // NOTE: paddingBottom is a layout prop (not GPU-composited). Replacing it with
    // translateY would require removing the laid-out space too — complex with the KAV
    // pairing. Left as-is; only the .get() read is fixed for React Compiler compat.
    paddingBottom: insets.bottom * (1 - keyboard.progress.get()),
  }));

  // The header is an absolute overlay, so the scroll content must be padded down
  // by its height. Any `paddingTop` the caller set is ADDED on top — a plain
  // style-array would let `contentStyle` (last) clobber the header offset, hiding
  // the content behind the bar and killing scroll on short pages.
  const collapsiblePadTop = useMemo(() => {
    const own = StyleSheet.flatten(contentStyle) as ViewStyle | undefined;
    const ownTop = typeof own?.paddingTop === 'number' ? own.paddingTop : 0;
    return headerH + ownTop;
  }, [contentStyle, headerH]);

  // A transparent native nav header sits above this screen (see SpaceStackLayout):
  // the body scrolls UNDER it, so pad the content down past the bar + notch (its
  // own paddingTop ADDED on top) — otherwise the first rows hide behind the bar.
  const nativeHeaderPadTop = useMemo(() => {
    if (!headerProvidedNatively) return undefined;
    const own = StyleSheet.flatten(contentStyle) as ViewStyle | undefined;
    const ownTop = typeof own?.paddingTop === 'number' ? own.paddingTop : 0;
    return layout.headerMinHeight + insets.top + ownTop;
  }, [headerProvidedNatively, contentStyle, insets.top]);

  if (collapsible) {
    return (
      <View style={[styles.root, { backgroundColor: bg }]}>
        {background === 'canvas' ? <DepthBackdrop /> : null}
        <KAV style={styles.flex}>
          <View style={inShell ? styles.centerFull : styles.center}>
            <Animated.ScrollView
              style={styles.flex}
              contentContainerStyle={[styles.scrollContent, contentStyle, { paddingTop: collapsiblePadTop }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={16}
            >
              {children}
            </Animated.ScrollView>
          </View>
          {!inTabs ? <SafeAreaView edges={['bottom']} style={{ backgroundColor: bg }} /> : null}
        </KAV>
        {/* Absolute header overlays the scroll content and slides out on scroll-down. */}
        <Animated.View
          style={[styles.absHeader, headerAnim]}
          onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
        >
          {/* Hook-based top inset (not <SafeAreaView edges={['top']}>): the native
              SafeAreaView ignores the AppFrame inset override, so it would re-reserve
              the notch under the OTA banner. `insets.top` follows the override. */}
          <View style={{ paddingTop: insets.top, backgroundColor: colors.paper }}>
            {headerNode}
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Subaqua depth behind the conversation so the room/thread pane carries the
          same atmosphere as the rest of the app. Only over `canvas` — a `paper`
          surface is meant to read as a solid sheet. Header/footer paint opaque
          paper on top, so the gradient shows through the message area only. */}
      {background === 'canvas' ? <DepthBackdrop /> : null}
      {/* A native nav-stack header already painted the top inset — render no header
          chrome here. Otherwise: in the desktop shell the pane has no top inset (the
          header sits flush); on mobile a SafeAreaView paints the notch. */}
      {headerProvidedNatively ? null : inShell ? (
        headerNode
      ) : (
        // Hook-based top inset (not <SafeAreaView edges={['top']}>) so it follows the
        // AppFrame inset override and doesn't re-reserve the notch under the banner.
        <View style={{ paddingTop: insets.top, backgroundColor: headerNode ? colors.paper : bg }}>
          {headerNode}
        </View>
      )}

      {/* When a `footer` is present on native (room/thread Composer), wrap the
          body+footer in a keyboard-controller KAV with `behavior="padding"` so the
          composer lifts above the keyboard and the LegendList above it shrinks to
          match. We do NOT use `automaticOffset` here: that prop calls the async
          native `viewPositionInWindow` bridge method to measure the KAV's y
          position. If the user taps the input before that async call resolves (very
          common on first open), `frame` is still `defaultLayout = {y:0,height:0}`,
          making `relativeKeyboardHeight = 0` and the composer hidden behind the
          keyboard. Without `automaticOffset`, `onLayout` sets the frame via
          `runOnUI` (synchronous JS→UI, no bridge round-trip), so the frame is ready
          before any tap can happen. The `layout.y` the KAV reports is its position
          relative to the root View (= header height = insets.top + headerMinHeight),
          which equals the screen-absolute y, so the math is identical.
          In the desktop shell or on web, KAV degrades to a plain View. */}
      <KAV
        style={styles.flex}
        behavior={footer && Platform.OS !== 'web' && !inShell ? 'padding' : undefined}
      >
        <View style={inShell ? styles.centerFull : styles.center}>
          {scroll ? (
            <ScrollView
              style={styles.flex}
              // nativeHeaderPadTop last so it ADDS to (doesn't get clobbered by) any
              // paddingTop the caller set in contentStyle.
              contentContainerStyle={[
                styles.scrollContent,
                contentStyle,
                nativeHeaderPadTop != null && { paddingTop: nativeHeaderPadTop },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            <View
              style={[
                styles.flex,
                contentStyle,
                nativeHeaderPadTop != null && { paddingTop: nativeHeaderPadTop },
              ]}
            >
              {children}
            </View>
          )}
        </View>

        {footer ? (
          inShell ? (
            <View style={{ backgroundColor: colors.paper }}>{footer}</View>
          ) : Platform.OS === 'web' ? (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.paper }}>
              {footer}
            </SafeAreaView>
          ) : (
            // Native: keyboard-aware bottom inset (see footerBottomInset) so the
            // composer sits snug above the keyboard instead of a notch's height above it.
            <Animated.View style={[{ backgroundColor: colors.paper }, footerBottomInset]}>
              {footer}
            </Animated.View>
          )
        ) : !inTabs && !inShell ? (
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: bg }} />
        ) : null}
      </KAV>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  centerFull: { flex: 1, width: '100%' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  absHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
});
