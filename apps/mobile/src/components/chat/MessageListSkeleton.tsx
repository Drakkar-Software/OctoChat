import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Skeleton } from '@/components/ui/Skeleton';

/** Loading placeholder shaped like a list of {@link MessageResult} rows, used
 *  while Search / Activity decrypt their results on-device. */
export function MessageListSkeleton({ count = 5 }: { count?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.row, { borderColor: colors.lineFaint, borderTopColor: colors.hairlineHi, backgroundColor: colors.paper }]}
        >
          <Skeleton width={32} height={32} radius={16} />
          <View style={styles.body}>
            <Skeleton width="42%" height={9} />
            <Skeleton width="58%" height={11} />
            <Skeleton width="88%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  body: { flex: 1, gap: 6, paddingVertical: 2 },
});
