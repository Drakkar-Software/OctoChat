import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { DOC_BODY, type DocBlock } from '@/lib/work-detail';
import { Avatar } from '@/components/ui/Avatar';
import { Callout } from '@/components/ui/Callout';
import { Divider } from '@/components/ui/Divider';
import { Pill } from '@/components/ui/Pill';
import { Reveal } from '@/components/ui/Reveal';
import { Txt } from '@/components/ui/Txt';

interface DocPlaceholderProps {
  emoji: string;
  label: string;
  hint?: string;
}

/**
 * Placeholder **doc** screen — an editorial preview of the encrypted page
 * editor. Believable prose (not shimmer) so a tapped row shows *what a doc will
 * look like*; the title/emoji come from the tapped row so it reads as that
 * specific page. A staggered reveal plays it in like a page filling. Inert: no
 * editing, nothing saved (the {@link Callout} says so). Tokens only.
 */
export function DocPlaceholder({ emoji, label, hint }: DocPlaceholderProps) {
  return (
    <View style={styles.wrap}>
      <Reveal>
        <View style={styles.metaTop}>
          <Pill label="Encrypted" tone="accent" iconName="lock" mono />
          {hint ? <Pill label={hint} tone="neutral" /> : null}
        </View>
        <View style={styles.hero}>
          <Txt variant="display" style={styles.emoji}>
            {emoji}
          </Txt>
          <Txt variant="display" weight="bold" style={styles.title}>
            {label}
          </Txt>
        </View>
        <View style={styles.byline}>
          <Avatar label="You" size={22} />
          <Txt variant="footnote" tone="inkMuted">
            You · Edited just now
          </Txt>
        </View>
      </Reveal>

      <Reveal delay={60}>
        <Divider style={styles.divider} />
        <Callout tone="accent" iconName="info">
          Preview — the encrypted block editor lands here soon. Nothing on this page is saved yet.
        </Callout>
      </Reveal>

      <View style={styles.body}>
        {DOC_BODY.map((block, i) => (
          <Reveal key={i} delay={140 + i * 70}>
            <DocBlockView block={block} />
          </Reveal>
        ))}
      </View>
    </View>
  );
}

function DocBlockView({ block }: { block: DocBlock }) {
  const { colors } = useTheme();
  switch (block.type) {
    case 'h2':
      return (
        <Txt variant="heading" weight="bold" style={styles.h2}>
          {block.text}
        </Txt>
      );
    case 'quote':
      return (
        <View style={[styles.quote, { borderLeftColor: colors.accentBorderStrong, backgroundColor: colors.accentBg }]}>
          <Txt variant="subhead" tone="accentInk">
            {block.text}
          </Txt>
        </View>
      );
    case 'bullets':
      return (
        <View style={styles.bullets}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <Txt variant="body" tone="inkSoft" style={styles.flex}>
                {item}
              </Txt>
            </View>
          ))}
        </View>
      );
    default:
      return (
        <Txt variant="body" tone="inkSoft">
          {block.text}
        </Txt>
      );
  }
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  metaTop: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  hero: { gap: spacing.xs },
  emoji: { fontSize: 40, lineHeight: 48 },
  title: { letterSpacing: -0.4 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  divider: { marginBottom: spacing.md },
  body: { gap: spacing.md },
  h2: { marginTop: spacing.sm },
  quote: { borderLeftWidth: 3, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.sm },
  bullets: { gap: spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: radii.pill, marginTop: 7 },
  flex: { flex: 1, minWidth: 0 },
});
