import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { layout } from '@/theme';
import { useInShell } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';

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
      {/* In the desktop shell the pane has no top inset — the header sits flush. */}
      {inShell ? (
        headerNode
      ) : (
        <SafeAreaView edges={['top']} style={{ backgroundColor: headerNode ? colors.paper : bg }}>
          {headerNode}
        </SafeAreaView>
      )}

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
