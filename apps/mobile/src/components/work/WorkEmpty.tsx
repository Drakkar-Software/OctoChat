import { StyleSheet, View } from 'react-native';

import { paperBorder, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { WORK_FACETS, type WorkFacet } from '@/lib/work-placeholder';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/**
 * Empty state for the **Work** tab — shown only once the object index has loaded
 * and holds no docs/projects (gated on `loaded`, never on a still-fetching index,
 * so a populated workspace never flashes this). Built on the shared {@link EmptyState}
 * (halo disc + editorial copy) with two LIVE create CTAs wired to `useObjects.create`
 * and a chip per facet describing what lands here. Once a doc/project exists this
 * disappears and the list tile takes over (see {@link WorkObjects}).
 */
export function WorkEmpty({ onNewDoc, onNewProject, disabled }: { onNewDoc: () => void; onNewProject: () => void; disabled?: boolean }) {
  return (
    <EmptyState
      iconName="book"
      title="Your encrypted workspace"
      subtitle="Docs, knowledge, projects and boards — sealed per-room with your space keyring. Create your first one to begin."
    >
      <View style={styles.actions}>
        <Button label="New doc" variant="primary" iconName="plus" size="sm" disabled={disabled} onPress={onNewDoc} />
        <Button label="New project" variant="secondary" iconName="plus" size="sm" disabled={disabled} onPress={onNewProject} />
      </View>
      <View style={styles.facets}>
        {WORK_FACETS.map((facet) => (
          <FacetChip key={facet.label} facet={facet} />
        ))}
      </View>
    </EmptyState>
  );
}

function FacetChip({ facet }: { facet: WorkFacet }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, paperBorder(colors)]}>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  facets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  chipText: { minWidth: 0, gap: 1 },
});
