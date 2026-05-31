import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { SYNC_BASE } from '@/lib/starfish/config';
import { useFcmTopicCount } from '@/lib/push/use-fcm-topic-count';
import { useServerHealth, type HealthStatus } from '@/lib/use-server-health';
import { useTheme } from '@/lib/use-theme';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Txt } from '@/components/ui/Txt';

const STATUS_LABEL: Record<HealthStatus, string> = {
  checking: 'Checking…',
  ok: 'Reachable',
  down: 'Unreachable',
};

/**
 * Diagnostics card under APP: shows whether the Starfish server
 * (EXPO_PUBLIC_STARFISH_URL) is reachable, plus — on native — how many FCM
 * space topics the device is currently subscribed to. Tap the server row to
 * re-probe immediately; the probe also re-runs on a 15 s interval.
 */
export function DebugStatsCard() {
  const { colors } = useTheme();
  const { status, latencyMs, recheck } = useServerHealth();
  const topicCount = useFcmTopicCount();

  const dotColor =
    status === 'ok' ? colors.success : status === 'down' ? colors.danger : colors.warning;
  const serverDetail =
    status === 'ok'
      ? `${SYNC_BASE} · ${latencyMs}ms`
      : status === 'down'
        ? SYNC_BASE
        : `${SYNC_BASE} · checking…`;

  return (
    <Card title="DIAGNOSTICS">
      <Row
        iconName="globe"
        title="Server"
        detail={serverDetail}
        detailMono
        onPress={recheck}
        right={
          <View style={styles.statusGroup}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Txt variant="caption" weight="semibold" mono>
              {STATUS_LABEL[status]}
            </Txt>
          </View>
        }
      />
      {Platform.OS !== 'web' ? (
        <>
          <Divider style={styles.divider} />
          <Row
            iconName="bell"
            title="Push topics"
            detail="Firebase space subscriptions"
            right={
              <Txt variant="callout" weight="semibold" mono>
                {topicCount}
              </Txt>
            }
          />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  divider: { marginVertical: spacing.xs },
  statusGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
