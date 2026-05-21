import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { Skeleton } from '@/components/ui/Skeleton';

/** Loading placeholder shaped like a category + its {@link ChannelRow}s, shown
 *  while a space's rooms load in the sidebar / rooms tab. */
export function ChannelListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.wrap}>
      <Skeleton width={70} height={8} style={styles.header} />
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={15} height={15} radius={radii.xs} />
          <Skeleton width={`${48 + ((i * 23) % 38)}%`} height={11} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.sm },
  header: { marginLeft: spacing.md, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
  },
});
