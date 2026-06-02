import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { glowShadow, paperBorder, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { WORK_FACETS, type WorkFacet } from '@/lib/work-placeholder';
import { Icon } from '@/components/ui/Icon';
import { PulseHalo } from '@/components/ui/PulseHalo';
import { Txt } from '@/components/ui/Txt';

/**
 * Header lockup for the **Work** placeholder — a marine band that frames the
 * docs/projects preview so the tab reads as a real (if unbuilt) workspace
 * surface rather than an empty list. A glowing sparkle disc on a top-lit accent
 * wash, the encrypted-workspace pitch, and a chip per facet (Docs · Projects).
 *
 * Horizontal lockup on purpose: the centered octopus disc reads as *onboarding*,
 * so this borrows {@link EmptyState}'s glow disc but lays it beside the copy to
 * read as a dashboard header. Pure composition over theme tokens, so light/dark
 * follow for free.
 */
export function WorkHero() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, paperBorder(colors), shadows.sm]}>
      <LinearGradient
        colors={[colors.accentBg, colors.paper]}
        locations={[0, 0.9]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.lockup}>
        <PulseHalo size={52} color={colors.accent}>
          <View
            style={[
              styles.disc,
              { backgroundColor: colors.accentBg, borderColor: colors.accentBorder, borderTopColor: colors.hairlineHi },
              glowShadow(colors.glow, 0.26, 16),
              // Strip Android's polygonal elevation shadow on the rounded disc
              // (web/iOS draw the clean bloom from the shadow* props). See HeroMark.
              { elevation: 0 },
            ]}
          >
            <Icon name="agents" size={24} color={colors.accent} />
          </View>
        </PulseHalo>
        <View style={styles.copy}>
          <Txt variant="title" weight="bold">
            Your encrypted workspace
          </Txt>
          <Txt variant="callout" tone="inkSoft">
            Docs, knowledge, projects and boards — sealed per-room with your space keyring. A preview of what lands here
            next.
          </Txt>
        </View>
      </View>
      <View style={styles.facets}>
        {WORK_FACETS.map((facet) => (
          <FacetChip key={facet.label} facet={facet} />
        ))}
      </View>
    </View>
  );
}

function FacetChip({ facet }: { facet: WorkFacet }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.lineSoft }]}>
      <Icon name={facet.iconName} size={15} color={colors.accent} />
      <View style={styles.chipText}>
        <Txt variant="footnote" weight="semibold">
          {facet.label}
        </Txt>
        <Txt variant="caption" tone="inkMuted" numberOfLines={1}>
          {facet.meta}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.lg,
    overflow: 'hidden',
  },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  disc: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  facets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexGrow: 1,
    flexBasis: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  chipText: { flex: 1, minWidth: 0, gap: 1 },
});
