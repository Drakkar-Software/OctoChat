import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { requesterDisplay } from '@/lib/request-display';
import type { PendingRequest } from '@drakkar.software/octochat-sdk';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Txt } from '@/components/ui/Txt';

interface RequestRowProps {
  entry: PendingRequest;
  /** True while this row's accept/decline is in flight (drives the button spinner + disables). */
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/** A single pending ticket request awaiting the owner's decision (manual-mode "Requests" shelf). */
export function RequestRow({ entry, busy, onAccept, onDecline }: RequestRowProps) {
  const { colors } = useTheme();
  const { req } = entry;
  const { who, shortId } = requesterDisplay(req);

  return (
    <View style={[styles.row, { borderColor: colors.ruleSoft }]}>
      <View style={styles.head}>
        <Avatar label={who.slice(0, 1).toUpperCase()} size={28} />
        <View style={styles.headText}>
          <Txt variant="caption" weight="medium" numberOfLines={1}>
            {who}
          </Txt>
          <Txt variant="micro" mono tone="inkFaint" numberOfLines={1}>
            {shortId}
          </Txt>
        </View>
      </View>

      <Txt variant="body" weight="medium" numberOfLines={2}>
        {req.title}
      </Txt>
      {req.message ? (
        <Txt variant="caption" tone="inkMuted" numberOfLines={2}>
          {req.message}
        </Txt>
      ) : null}

      <View style={styles.actions}>
        <Button label="Decline" variant="secondary" size="sm" disabled={busy} onPress={onDecline} />
        <Button label="Accept" variant="primary" size="sm" loading={busy} onPress={onAccept} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    padding: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headText: { flex: 1, gap: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
});
