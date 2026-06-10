/**
 * Ghost suggestion chip above the composer when an on-device AI suggestion is
 * ready or generating. Fades in; shows bouncing dots while the model streams;
 * tap to accept; ✕ to dismiss. The model can suggest more than a reply — react,
 * start a thread, or pin — so the chip renders per action kind (a `reply` previews
 * its streaming text; the others show a labelled action).
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { glowShadow, motion, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';
import { FadeView } from '@/components/ui/FadeView';

import type { SuggestionAction } from '@drakkar.software/octochat-sdk';
import type { SuggestionStatus } from '@/lib/ai/use-reply-suggestion';

interface ReplySuggestionChipProps {
  status: SuggestionStatus;
  action: SuggestionAction | null;
  onAccept: () => void;
  onDismiss: () => void;
}

/** Single dot in the "AI thinking" bounce animation. */
function Dot({ color, delay }: { color: string; delay: number }) {
  const reduced = useReducedMotion();
  const y = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    y.value = withDelay(
      delay,
      withRepeat(
        withTiming(-5, { duration: 320, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(y);
  }, [y, delay, reduced]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : y.value }],
    opacity: reduced ? 0.35 : 1,
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, animStyle]} />;
}

/** A11y label + leading icon for each action kind. */
const ACTION_META: Record<SuggestionAction['kind'], { icon: IconName; label: string }> = {
  reply: { icon: 'sparkles', label: 'Use suggested reply' },
  react: { icon: 'smile', label: 'React to the message' },
  thread: { icon: 'thread', label: 'Reply in a thread' },
  pin: { icon: 'pin', label: 'Pin the message' },
};

/** The tappable inner content for a ready/streaming action. */
function ActionContent({ action, color, muted }: { action: SuggestionAction; color: string; muted: string }) {
  if (action.kind === 'reply') {
    return (
      <Txt variant="footnote" color={color} numberOfLines={2}>
        {action.text}
      </Txt>
    );
  }
  if (action.kind === 'react') {
    return (
      <View style={styles.actionRow}>
        <Txt variant="subhead">{action.emoji}</Txt>
        <Txt variant="footnote" color={muted}>
          React with this
        </Txt>
      </View>
    );
  }
  if (action.kind === 'thread') {
    return (
      <View style={styles.actionCol}>
        <Txt variant="footnote" weight="medium" color={color}>
          Reply in a thread
        </Txt>
        {action.text ? (
          <Txt variant="footnote" color={muted} numberOfLines={1}>
            {action.text}
          </Txt>
        ) : null}
      </View>
    );
  }
  return (
    <Txt variant="footnote" weight="medium" color={color}>
      Pin this message
    </Txt>
  );
}

export function ReplySuggestionChip({ status, action, onAccept, onDismiss }: ReplySuggestionChipProps) {
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
  // Dots until we know the action (the bare keyword is still streaming).
  const showDots = !action;
  const meta = action ? ACTION_META[action.kind] : ACTION_META.reply;

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
          // The chip's accentBg is translucent; Android can't derive a rounded
          // outline from it, so the elevation shadow paints the square view bounds
          // (a stray bar behind the pill). iOS/web use the shadow* props, so drop
          // only Android's elevation here.
          Platform.OS === 'android' && { elevation: 0 },
        ]}
      >
        {/* Leading icon — sparkles while thinking / for a reply, action-specific otherwise */}
        <Icon name={showDots ? 'sparkles' : meta.icon} size={14} color={colors.accent} />

        {/* Content area */}
        <View style={styles.content}>
          {showDots ? (
            // Three bouncing dots while the model streams its first tokens.
            <View style={styles.dotsRow}>
              <Dot color={colors.accent} delay={0} />
              <Dot color={colors.accent} delay={150} />
              <Dot color={colors.accent} delay={300} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={meta.label}
              onPress={onAccept}
              style={styles.textPressable}
            >
              <ActionContent action={action} color={colors.accent} muted={colors.inkMuted} />
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
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  textPressable: {
    paddingVertical: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionCol: {
    gap: 1,
  },
});
