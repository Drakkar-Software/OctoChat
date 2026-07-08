import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet } from '@octochat/ui';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Optional header label rendered above the scrollable body. */
  title?: string;
  children: ReactNode;
}

/**
 * Native bottom sheet — SwiftUI `.sheet` (iOS) / Material 3 `ModalBottomSheet`
 * (Android) via `@octochat/ui`, painted with the marine paper surface. The web
 * build uses the Overlay-based sibling (`BottomSheet.tsx`). Same
 * `visible`/`onClose`/`title`/`children` API, so call sites (incl. the
 * `renderContainer` render-prop) are unchanged.
 */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Sheet visible={visible} onClose={onClose} backgroundColor={colors.paper}>
      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {title ? (
          <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted" style={styles.title}>
            {title}
          </Txt>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm },
  title: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  body: { paddingBottom: spacing.sm, paddingHorizontal: spacing.none },
});
