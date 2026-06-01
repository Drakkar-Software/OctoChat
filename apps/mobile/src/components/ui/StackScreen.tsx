import type { ReactNode } from 'react';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
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
        const dy = y - lastY.value;
        lastY.value = y;
        // Near the top the header is always shown (no blank strip); below that,
        // accumulate scroll delta clamped to [-headerH, 0].
        headerY.value = y <= headerH ? 0 : Math.min(0, Math.max(-headerH, headerY.value - dy));
      },
    },
    [headerH],
  );
  const headerAnim = useAnimatedStyle(() => ({ transform: [{ translateY: headerY.value }] }));

  if (collapsible) {
    return (
      <View style={[styles.root, { backgroundColor: bg }]}>
        {background === 'canvas' ? <DepthBackdrop /> : null}
        <KAV style={styles.flex}>
          <View style={inShell ? styles.centerFull : styles.center}>
            <Animated.ScrollView
              style={styles.flex}
              contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }, contentStyle]}
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
          <SafeAreaView edges={['top']} style={{ backgroundColor: colors.paper }}>
            {headerNode}
          </SafeAreaView>
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
      {/* In the desktop shell the pane has no top inset — the header sits flush. */}
      {inShell ? (
        headerNode
      ) : (
        <SafeAreaView edges={['top']} style={{ backgroundColor: headerNode ? colors.paper : bg }}>
          {headerNode}
        </SafeAreaView>
      )}

      {/* When a `footer` is present on native (room/thread Composer), wrap the
          body+footer in a keyboard-controller KAV with `behavior="padding"` so the
          composer lifts above the keyboard and the LegendList above it shrinks to
          match. `automaticOffset` measures this view's screen position so we don't
          have to compute a `keyboardVerticalOffset` for the AppBar/notch ourselves.
          In the desktop shell or on web, KAV degrades to a plain View. */}
      <KAV
        style={styles.flex}
        behavior={footer && Platform.OS !== 'web' && !inShell ? 'padding' : undefined}
        automaticOffset={footer && Platform.OS !== 'web' && !inShell ? true : undefined}
      >
        <View style={inShell ? styles.centerFull : styles.center}>
          {scroll ? (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={[styles.scrollContent, contentStyle]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.flex, contentStyle]}>{children}</View>
          )}
        </View>

        {footer ? (
          inShell ? (
            <View style={{ backgroundColor: colors.paper }}>{footer}</View>
          ) : (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.paper }}>
              {footer}
            </SafeAreaView>
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
