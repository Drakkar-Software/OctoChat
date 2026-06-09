/**
 * Ghost suggestion chip that appears above the composer when an on-device AI reply
 * suggestion is ready or being generated. Fades in smoothly; shimmers while the
 * model streams; tap to accept (fills the composer, editable); ✕ to dismiss.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { glowShadow, motion, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Txt } from '@/components/ui/Txt';
import { FadeView } from '@/components/ui/FadeView';

import type { SuggestionStatus } from '@/lib/ai/use-reply-suggestion';

interface ReplySuggestionChipProps {
  status: SuggestionStatus;
  text: string | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function ReplySuggestionChip({ status, text, onAccept, onDismiss }: ReplySuggestionChipProps) {
  const { colors } = useTheme();

  // FadeView initializes its shared value from the `visible` prop at mount time.
  // If we mount with visible=true, it snaps to 1 with no animation. Delay by one
  // frame so the view mounts at opacity 0, then the effect fires and fades it in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 16);
    return () => clearTimeout(id);
  }, []);

  const visible = mounted && (status === 'generating' || status === 'ready');

  return (
    <FadeView
      visible={visible}
      duration={visible ? motion.base : motion.fast}
      style={styles.wrap}
    >
      <View
        style={[
          styles.chip,
          {
            backgroundColor: colors.accentBg,
            borderColor: colors.accentBorder,
          },
          glowShadow(colors.glow, 0.14, 10),
        ]}
      >
        {/* Sparkle icon */}
        <Icon name="sparkles" size={14} color={colors.accent} />

        {/* Content area */}
        <View style={styles.content}>
          {status === 'generating' && !text ? (
            // Shimmer skeleton while generating the first tokens.
            <View style={styles.skeletons}>
              <Skeleton height={10} width="80%" radius={radii.xs} />
              <Skeleton height={10} width="55%" radius={radii.xs} style={styles.skeletonRow} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use suggested reply"
              onPress={onAccept}
              style={styles.textPressable}
            >
              <Txt
                variant="footnote"
                color={colors.accent}
                numberOfLines={2}
              >
                {text ?? ''}
              </Txt>
            </Pressable>
          )}
        </View>

        {/* Dismiss */}
        <IconButton
          name="x"
          size={13}
          color={colors.inkMuted}
          accessibilityLabel="Dismiss suggestion"
          onPress={onDismiss}
        />
      </View>
    </FadeView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingLeft: spacing.md,
    paddingRight: 6,
    borderRadius: radii.sheet,
    borderWidth: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  textPressable: {
    // Give the text a generous tap target without inflating the chip height.
    paddingVertical: 2,
  },
  skeletons: {
    gap: 6,
    paddingVertical: 2,
  },
  skeletonRow: {
    marginTop: 0,
  },
});
