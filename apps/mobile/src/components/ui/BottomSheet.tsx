import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Overlay } from '@/components/ui/Overlay';
import { Txt } from '@/components/ui/Txt';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Optional header label rendered above the scrollable body. */
  title?: string;
  children: ReactNode;
}

/**
 * Reusable bottom-sheet modal. Slides/springs in from the bottom on native with a
 * web fade-in CSS transition via {@link Overlay}. Top corners use `radii.sheet`.
 * Safe-area bottom padding applied automatically.
 *
 * Dismissal: backdrop tap · Android back button · web Escape key (all handled
 * by Overlay).
 *
 * Usage in a `renderContainer` render-prop (e.g. {@link SpaceSwitcher}):
 * ```tsx
 * renderContainer={({ isOpen, onClose, children }) => (
 *   <BottomSheet visible={isOpen} onClose={onClose} title="Switch space">
 *     {children}
 *   </BottomSheet>
 * )}
 * ```
 */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // A percentage maxHeight is unresolvable when the parent is content-sized (which
  // the Overlay content chain is by design). Derive a concrete pixel cap instead so
  // the sheet actually clamps on short content and bottom-anchoring works.
  const { height } = useWindowDimensions();

  return (
    <Overlay visible={visible} onClose={onClose} placement="bottom">
      {/* KAV must live inside the Modal (via Overlay) so it can respond to the
          keyboard that appears over this modal's layer. On iOS it adds bottom
          padding equal to the keyboard height; on Android the OS handles
          adjustResize instead. */}
      <KeyboardAvoidingView
        style={styles.avoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Inner Pressable swallows taps so they don't fall through to the
            Overlay backdrop — Overlay itself handles backdrop dismiss. */}
        <Pressable
          style={[
            styles.sheet,
            {
              maxHeight: Math.round(height * 0.85),
              backgroundColor: colors.paper,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
          onPress={() => undefined}
        >
          <View style={[styles.handle, { backgroundColor: colors.lineSoft }]} />
          {title ? (
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted" style={styles.title}>
              {title}
            </Txt>
          ) : null}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  avoid: {
    // The KAV is no longer the full-screen container (Overlay owns the absolute
    // full-height parent); flexShrink lets it collapse to its content height so
    // it doesn't stretch beyond the sheet. maxHeight + backgroundColor + safe-area
    // padding are applied inline (dynamic, depend on window height / insets / theme).
    flexShrink: 1,
  },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  handle: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  // Shrink to content height; never stretch shorter content to fill the max.
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingBottom: spacing.sm },
});
