import { Pressable, StyleSheet, View } from 'react-native';

import { paperBorder, radii, shadows, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { type WorkItem, type WorkSection } from '@/lib/work-placeholder';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { WorkHero } from './WorkHero';

interface WorkPanelProps {
  /** The placeholder tree to render (e.g. Docs or Projects sections). */
  sections: WorkSection[];
  /** Lead-in callout copy describing what the mode will hold (compact surfaces). */
  note?: string;
  /** Show the full marine hero lockup — the roomy Work tab, not the sidebar rail. */
  hero?: boolean;
}

/**
 * Body of the placeholder workspace mode (**Work** = docs + projects) — each
 * group is a framed paper tile holding a Notion-style page tree, so the mode
 * reads as a real surface before the feature exists. Rows are inert (no routing
 * yet); future areas dim with a SOON pill. The {@link sections} tree comes from
 * `work-placeholder`. With {@link hero} it leads with {@link WorkHero} (the Work
 * tab); without it stays compact for the desktop sidebar rail.
 */
export function WorkPanel({ sections, note, hero }: WorkPanelProps) {
  return (
    <View style={styles.panel}>
      {hero ? <WorkHero /> : null}
      {note ? (
        <Callout tone="info" iconName="info">
          {note}
        </Callout>
      ) : null}
      {sections.map((section) => (
        <WorkSectionGroup key={section.title} section={section} />
      ))}
    </View>
  );
}

function WorkSectionGroup({ section }: { section: WorkSection }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, paperBorder(colors), shadows.sm, section.future && styles.future]}>
      <View style={styles.sectionHead}>
        <Icon name={section.iconName} size={13} color={colors.inkMuted} />
        <Txt variant="caption" weight="bold" tone="inkMuted" style={styles.sectionTitle}>
          {section.title.toUpperCase()}
        </Txt>
        {section.future ? (
          <View style={[styles.soon, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}>
            <Txt variant="micro" mono tone="inkFaint">
              SOON
            </Txt>
          </View>
        ) : null}
      </View>
      {section.items.map((item) => (
        <WorkPageRow key={item.id} item={item} />
      ))}
    </View>
  );
}

function WorkPageRow({ item }: { item: WorkItem }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      {...hoverProps}
      style={[styles.row, { backgroundColor: hovered ? colors.hover : 'transparent' }]}
    >
      <Txt variant="subhead" style={styles.emoji}>
        {item.emoji}
      </Txt>
      <View style={styles.rowText}>
        <Txt variant="subhead" numberOfLines={1}>
          {item.label}
        </Txt>
        {item.hint ? (
          <Txt variant="caption" tone="inkFaint" numberOfLines={1}>
            {item.hint}
          </Txt>
        ) : null}
      </View>
      <Icon name="chev" size={14} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  tile: { borderRadius: radii.card, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, gap: 2 },
  future: { opacity: 0.55 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  sectionTitle: { flex: 1, letterSpacing: 0.5 },
  soon: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.xs, borderWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  emoji: { width: 20, textAlign: 'center' },
  rowText: { flex: 1, minWidth: 0 },
});
