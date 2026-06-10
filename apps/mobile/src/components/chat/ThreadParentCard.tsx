import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { paperBorder, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/**
 * Anchor card for a thread's parent message. Gives the message a distinct "this is
 * the origin of a side conversation" identity — a lifted paper surface with the
 * lit-from-above top edge, a left accent rule (the {@link MessageGroup} mention-bar
 * idiom), and a small "thread" eyebrow — so it reads as the pinned origin separated
 * from the reply stream rather than a slightly-tinted normal message.
 *
 * Thin wrapper: it frames whatever message row is passed as {@link children} (a
 * `MessageGroup`, rendered WITHOUT its own `highlighted` tint — the card supplies
 * the accent identity), honoring reuse. The row keeps its native horizontal padding,
 * so the eyebrow is inset to match its left edge and the card hugs the screen gutter.
 */
export function ThreadParentCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.card, paperBorder(colors, colors.accentBorder), shadows.sm]}>
        {/* Left accent rule marks the origin, mirroring the message mention-bar. */}
        <View style={[styles.rule, { backgroundColor: colors.accent }]} />
        <View style={styles.eyebrow}>
          <Icon name="thread" size={13} color={colors.accent} />
          <Txt variant="micro" weight="bold" mono uppercase tone="accent">
            Thread
          </Txt>
        </View>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A small gutter so the card edge sits inside the screen padding.
  wrap: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  card: {
    borderWidth: 1,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  // Inset to the message row's own screenX so the eyebrow lines up with the author.
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.screenX,
    paddingBottom: spacing.xs,
  },
  rule: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
});
