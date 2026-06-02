import { ScrollView, StyleSheet, View } from 'react-native';

import { layout, paperBorder, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { BOARD_COLUMNS, BOARD_PROGRESS, type BoardCard, type BoardColumn } from '@/lib/work-detail';
import { Avatar } from '@/components/ui/Avatar';
import { Callout } from '@/components/ui/Callout';
import { Pill } from '@/components/ui/Pill';
import { Reveal } from '@/components/ui/Reveal';
import { Txt } from '@/components/ui/Txt';

interface ProjectPlaceholderProps {
  emoji: string;
  label: string;
  hint?: string;
}

/**
 * Placeholder **project** screen — a kanban preview of what a board will look
 * like. Real-feeling faux cards (title, tag, assignees) across three lanes, with
 * a progress meter, so a tapped row previews the surface rather than a loading
 * state. Title/emoji come from the tapped row. Inert; the {@link Callout} marks
 * it a preview. Tokens only.
 */
export function ProjectPlaceholder({ emoji, label, hint }: ProjectPlaceholderProps) {
  const { colors } = useTheme();
  const pct = Math.round((BOARD_PROGRESS.done / BOARD_PROGRESS.total) * 100);
  return (
    <View style={styles.wrap}>
      <Reveal style={styles.head}>
        <View style={styles.hero}>
          <Txt variant="display" style={styles.emoji}>
            {emoji}
          </Txt>
          <View style={styles.flex}>
            <Txt variant="title" weight="bold" numberOfLines={2}>
              {label}
            </Txt>
            <View style={styles.metaRow}>
              <Pill label={hint || 'In progress'} tone="accent" iconName="target" />
              <Txt variant="footnote" tone="inkMuted">
                {BOARD_PROGRESS.done}/{BOARD_PROGRESS.total} done
              </Txt>
            </View>
          </View>
        </View>
        <View style={[styles.track, { backgroundColor: colors.fill }]}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accent }]} />
        </View>
      </Reveal>

      <Reveal delay={60}>
        <Callout tone="accent" iconName="info">
          Preview — boards become live and drag-droppable when Projects ship. Nothing here is saved yet.
        </Callout>
      </Reveal>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.boardContent}
        style={styles.board}
      >
        {BOARD_COLUMNS.map((column, i) => (
          <Reveal key={column.id} delay={140 + i * 80} style={styles.column}>
            <BoardColumnView column={column} />
          </Reveal>
        ))}
      </ScrollView>
    </View>
  );
}

function BoardColumnView({ column }: { column: BoardColumn }) {
  const { colors } = useTheme();
  return (
    <View style={styles.columnInner}>
      <View style={styles.columnHead}>
        <Txt variant="caption" weight="bold" uppercase tone="inkSoft">
          {column.title}
        </Txt>
        <Pill label={String(column.cards.length)} tone="neutral" mono />
      </View>
      {column.cards.map((card) => (
        <BoardCardView key={card.id} card={card} />
      ))}
      <View style={[styles.addCard, { borderColor: colors.lineFaint }]}>
        <Txt variant="footnote" tone="inkFaint">
          + Add card
        </Txt>
      </View>
    </View>
  );
}

function BoardCardView({ card }: { card: BoardCard }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, paperBorder(colors), shadows.sm]}>
      <Txt variant="subhead" weight="medium">
        {card.title}
      </Txt>
      <View style={styles.cardFoot}>
        <Pill label={card.tag} tone={card.tone} />
        <View style={styles.avatars}>
          {card.assignees.map((label, i) => (
            <View key={i} style={i > 0 ? styles.avatarStacked : undefined}>
              <Avatar label={label} size={20} ring />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  head: { gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emoji: { fontSize: 40, lineHeight: 48 },
  flex: { flex: 1, minWidth: 0, gap: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { height: 6, borderRadius: radii.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill },
  board: { marginHorizontal: -spacing.screenX },
  boardContent: { gap: spacing.md, paddingHorizontal: spacing.screenX, paddingVertical: spacing.xs },
  column: { width: layout.boardColumnWidth },
  columnInner: { gap: spacing.sm },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  card: { borderRadius: radii.card, borderWidth: 1, padding: spacing.md, gap: spacing.md },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  avatars: { flexDirection: 'row' },
  avatarStacked: { marginLeft: -spacing.sm },
  addCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
});
