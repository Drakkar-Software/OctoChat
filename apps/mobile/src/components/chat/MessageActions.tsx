import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, shadows, spacing } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { QUICK_REACTIONS } from '@/lib/reactions';
import { useTheme } from '@/lib/use-theme';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface MessageActionsProps {
  /** Show the toolbar — driven by row hover on web; always true on native. */
  visible: boolean;
  /** Add/toggle a reaction emoji. Omit to hide the react button. */
  onReact?: (emoji: string) => void;
  /** Open a thread reply. Omit to hide the reply button (e.g. inside a thread). */
  onReply?: () => void;
  /** Emojis the user has already reacted with, highlighted in the picker. */
  mine?: Set<string>;
}

/**
 * Floating per-message action toolbar pinned to the row's top-right and shown on
 * hover. Being absolutely positioned, it overlays the message and never shifts
 * surrounding content. Tapping react swaps the bar for a quick-emoji picker in
 * place — still anchored, so still no reflow.
 */
export function MessageActions({ visible, onReact, onReply, mine }: MessageActionsProps) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState(false);
  if (!visible && !picking) return null;

  const pick = (emoji: string) => {
    tapFeedback();
    onReact?.(emoji);
    setPicking(false);
  };

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.paper, borderColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
        shadows.sm,
      ]}
    >
      {picking ? (
        <>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              onPress={() => pick(emoji)}
              style={[styles.emoji, mine?.has(emoji) ? { backgroundColor: colors.accentBg } : null]}
            >
              <Txt variant="footnote">{emoji}</Txt>
            </Pressable>
          ))}
          <IconButton name="x" size={14} color={colors.inkMuted} accessibilityLabel="Close reaction picker" onPress={() => setPicking(false)} />
        </>
      ) : (
        <>
          {onReact ? (
            <IconButton
              name="smile"
              size={16}
              color={colors.inkSoft}
              accessibilityLabel="Add reaction"
              onPress={() => {
                tapFeedback();
                setPicking(true);
              }}
            />
          ) : null}
          {onReply ? (
            <IconButton name="thread" size={16} color={colors.inkSoft} accessibilityLabel="Reply in thread" onPress={onReply} />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.screenX,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  emoji: {
    minWidth: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
});
