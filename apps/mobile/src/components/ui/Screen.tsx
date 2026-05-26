import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { layout } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { DepthBackdrop } from './DepthBackdrop';

interface ScreenProps {
  children: ReactNode;
  /** Safe-area edges to inset. Default top + bottom. */
  edges?: Edge[];
  /** Paint the subaquatic depth gradient behind content. Default true. */
  gradient?: boolean;
  /** Center + cap content width on wide/web viewports. Default true. */
  center?: boolean;
  /** Style applied to the inner content container. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Generic screen scaffold: marine canvas + subaqua depth gradient + safe-area
 * insets, with optional max-width centering so the app reads well on web.
 */
export function Screen({ children, edges = ['top', 'bottom'], gradient = true, center = true, style }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      {gradient ? <DepthBackdrop /> : null}
      <SafeAreaView edges={edges} style={styles.safe}>
        <View style={[styles.content, center && styles.centered, style]}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, alignItems: 'center' },
  content: { flex: 1, width: '100%' },
  centered: { maxWidth: layout.maxContentWidth, alignSelf: 'center' },
});
