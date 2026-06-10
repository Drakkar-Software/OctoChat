import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { Skeleton } from '@/components/ui/Skeleton';

/** Loading placeholder shaped like the grouped channel list — a couple of
 *  category "shelves", each a faint header + a few indented {@link ChannelRow}s —
 *  so the skeleton-to-content swap keeps its silhouette while a space's rooms
 *  load in the sidebar / rooms tab. */
export function ChannelListSkeleton({ rows = 5 }: { rows?: number }) {
  // Split the requested rows across two shelves so the silhouette reads as
  // grouped (header + rows) rather than one flat run.
  const groups = [Math.ceil(rows / 2), Math.floor(rows / 2)].filter((n) => n > 0);
  let seed = 0;
  return (
    <View style={styles.wrap}>
      {groups.map((count, g) => (
        <View key={g} style={styles.section}>
          <Skeleton shimmer width={64} height={9} style={styles.header} />
          {Array.from({ length: count }).map((_, i) => {
            const w = 46 + ((seed++ * 23) % 40);
            return (
              <View key={i} style={styles.row}>
                <Skeleton shimmer width={15} height={15} radius={radii.xs} />
                <Skeleton shimmer width={`${w}%`} height={11} />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.sm },
  // Mirrors RoomCategorySection's shelf spacing so the swap lines up.
  section: { paddingTop: spacing.xs, marginBottom: spacing.sm },
  header: { marginLeft: spacing.md, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.rowY,
    paddingHorizontal: spacing.md,
  },
});
