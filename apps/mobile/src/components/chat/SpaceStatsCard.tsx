import { StyleSheet, View } from 'react-native';

import { getElevation, radii, spacing } from '@/theme';
import { formatBytes } from '@drakkar.software/octochat-sdk';
import type { SpaceStats } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Skeleton } from '@/components/ui/Skeleton';
import { Txt } from '@/components/ui/Txt';

interface SpaceStatsCardProps {
  stats: SpaceStats | null;
  loading: boolean;
}

/** One labelled metric tile in the 2×2 grid. */
function Stat({ label, value }: { label: string; value: number }) {
  const { colors } = useTheme();
  const e1 = getElevation(colors).e1;
  return (
    <View style={[styles.tile, { backgroundColor: e1.surface, borderColor: e1.border }]}>
      <Txt variant="title" weight="bold" tabularNums>
        {value}
      </Txt>
      <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
        {label}
      </Txt>
    </View>
  );
}

/**
 * STORAGE card for the space screen (owner-only): the space's approximate stored
 * size as a display-scale hero, with room / message / thread / attachment counts in
 * a 2×2 grid. Size is computed client-side and labelled "~" (see `space-stats.ts`).
 */
export function SpaceStatsCard({ stats, loading }: SpaceStatsCardProps) {
  if (loading || !stats) {
    return (
      <Card title="STORAGE">
        <Skeleton width={140} height={32} />
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.tileSkeleton}>
              <Skeleton width={48} height={22} />
              <Skeleton width={64} height={10} />
            </View>
          ))}
        </View>
      </Card>
    );
  }

  return (
    <Card title="STORAGE">
      <View style={styles.sizeRow}>
        <Txt variant="display" weight="bold" tabularNums>
          ~{formatBytes(stats.bytes)}
        </Txt>
        <Txt variant="caption" weight="semibold" mono uppercase tone="inkMuted">
          approx. size
        </Txt>
      </View>
      <Divider style={styles.divider} />
      <View style={styles.grid}>
        <Stat label="Rooms" value={stats.rooms} />
        <Stat label="Messages" value={stats.messages} />
        <Stat label="Threads" value={stats.threads} />
        <Stat label="Attachments" value={stats.attachments} />
      </View>
      {stats.partial ? (
        <Callout tone="warning" iconName="alert" title="Some rooms couldn’t be read">
          Totals may be lower than the real size.
        </Callout>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  sizeRow: { gap: spacing.hair },
  divider: { marginVertical: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    gap: spacing.hair,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  tileSkeleton: { flexGrow: 1, flexBasis: '46%', gap: spacing.xs, paddingVertical: spacing.sm },
});
