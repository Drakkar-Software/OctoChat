import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import { Txt } from '@/components/ui/Txt';

interface ObjectHeroProps {
  /** Optional emoji glyph shown before the title. */
  emoji?: string;
  /** Object title; falls back to "Untitled" when empty. */
  title?: string;
  /** Optional secondary line under the title (e.g. a project's done count). */
  subtitle?: string;
  /** Optional trailing control aligned to the row's end (e.g. an "Add column" button). */
  trailing?: ReactNode;
}

/**
 * The header for a Work `doc`/`project` view: an emoji + display title (+ optional
 * subtitle and a trailing control). Shared by {@link DocView} and {@link ProjectBoard}
 * so the hero markup + emoji sizing live in one place.
 */
export function ObjectHero({ emoji, title, subtitle, trailing }: ObjectHeroProps) {
  return (
    <View style={styles.hero}>
      {emoji ? <Txt style={styles.emoji}>{emoji}</Txt> : null}
      <View style={styles.text}>
        <Txt variant="display" weight="bold">
          {title || 'Untitled'}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="inkFaint">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emoji: { fontSize: layout.objectHeroEmoji },
  text: { flex: 1, gap: 2 },
});
