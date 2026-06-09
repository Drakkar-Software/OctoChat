/**
 * Renders a "catch me up" summary as per-room sections. Each section that names a
 * known room is a single tappable block (header + body both open the room), with a
 * channel-style `#name` header — replacing the raw markdown headings, which let a
 * literal "##" leak through and only made the heading TEXT clickable.
 */
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { openRoom } from '@/lib/links';
import { splitDigestSections } from '@/lib/ai/digest-sections';
import { useTheme } from '@/lib/use-theme';
import type { Room } from '@drakkar.software/octochat-sdk';
import { Markdown } from '@/components/ui/Markdown';
import { Txt } from '@/components/ui/Txt';

interface DigestSummaryProps {
  /** Raw (possibly still-streaming) summary text. */
  summary: string;
  /** Maps a room name to its {@link Room} so the section can link. */
  resolveRoom?: (name: string) => Room | undefined;
}

export function DigestSummary({ summary, resolveRoom }: DigestSummaryProps) {
  const { colors } = useTheme();
  const sections = splitDigestSections(summary);

  return (
    <View style={styles.wrap}>
      {sections.map((s, i) => {
        const room = s.room ? resolveRoom?.(s.room) : undefined;
        const header = s.room ? (
          <Txt
            variant="heading"
            weight="bold"
            tone={room ? 'accent' : undefined}
            // Channel-style single `#` — the model's own `#`/`##` is stripped upstream.
            numberOfLines={1}
          >
            {`#${s.room}`}
          </Txt>
        ) : null;
        const body = s.body ? <Markdown source={s.body} resolveRoom={resolveRoom} /> : null;
        const inner = (
          <View style={styles.section}>
            {header}
            {body}
          </View>
        );
        // A resolved room → the whole section opens it. Otherwise render inert.
        return room ? (
          <Pressable
            key={i}
            accessibilityRole="link"
            accessibilityLabel={`Open #${s.room}`}
            onPress={() => openRoom(room)}
            style={({ pressed }) => [styles.linked, pressed ? { backgroundColor: colors.accentBg } : null]}
          >
            {inner}
          </Pressable>
        ) : (
          <View key={i}>{inner}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  section: { gap: spacing.sm },
  // Negative-margin + padding so the pressed highlight bleeds to the card edges
  // without shifting the text. Web gets a pointer cursor on the whole block.
  linked: {
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: spacing.sm,
    ...Platform.select({ web: { cursor: 'pointer' } as object, default: {} }),
  },
});
