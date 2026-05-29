import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

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
}: StackScreenProps) {
  const { colors } = useTheme();
  const inShell = useInShell();
  const bg = background === 'paper' ? colors.paper : colors.canvas;
  const headerNode = inShell ? (desktopHeader ?? header) : header;

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
});
