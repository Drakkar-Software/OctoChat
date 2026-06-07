import { Fragment } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { formatBytes } from '@drakkar.software/octochat-sdk';
import type { SpaceStats } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Txt } from '@/components/ui/Txt';

interface SpaceStatsCardProps {
  stats: SpaceStats | null;
  loading: boolean;
}

/**
 * STORAGE card for the space screen (owner-only). Shows the space's approximate
 * stored size plus room / message / thread / attachment counts. Size is computed
 * client-side and labelled "~" — it is not an authoritative server figure (see
 * `space-stats.ts`). While the per-room fan-out runs it shows a spinner.
 */
export function SpaceStatsCard({ stats, loading }: SpaceStatsCardProps) {
  const { colors } = useTheme();

  const rows = stats
    ? [
        { label: 'Approx. size', value: `~${formatBytes(stats.bytes)}` },
        { label: 'Rooms', value: String(stats.rooms) },
        { label: 'Messages', value: String(stats.messages) },
        { label: 'Threads', value: String(stats.threads) },
        { label: 'Attachments', value: String(stats.attachments) },
      ]
    : [];

  return (
    <Card title="STORAGE">
      {loading || !stats ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Txt variant="footnote" tone="inkMuted">
            Calculating…
          </Txt>
        </View>
      ) : (
        <>
          {rows.map((r, i) => (
            <Fragment key={r.label}>
              {i > 0 ? <Divider style={styles.divider} /> : null}
              <View style={styles.row}>
                <Txt variant="footnote" tone="inkSoft">
                  {r.label}
                </Txt>
                <Txt variant="callout" weight="semibold">
                  {r.value}
                </Txt>
              </View>
            </Fragment>
          ))}
          {stats.partial ? (
            <Callout tone="warning" iconName="alert" title="Some rooms couldn’t be read">
              Totals may be lower than the real size.
            </Callout>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  divider: { marginVertical: spacing.xs },
});
