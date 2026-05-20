import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { layout } from '@/theme';
import { useTheme } from '@/lib/use-theme';

interface StackScreenProps {
  /** Header node (usually <AppBar/>); its safe-area inset is painted paper. */
  header?: ReactNode;
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
  footer,
  children,
  scroll = false,
  background = 'canvas',
  contentStyle,
  inTabs = false,
}: StackScreenProps) {
  const { colors } = useTheme();
  const bg = background === 'paper' ? colors.paper : colors.canvas;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: header ? colors.paper : bg }}>
        {header}
      </SafeAreaView>

      <View style={styles.center}>
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
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.paper }}>
          {footer}
        </SafeAreaView>
      ) : !inTabs ? (
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: bg }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
