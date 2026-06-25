/**
 * "Catch me up" — on-demand AI summary of unread messages across a space.
 * Appears on the per-space room list when there are unread messages and AI is enabled.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useAiSettings } from '@/lib/ai-settings-context';
import { useSpaceDigest } from '@/lib/ai/use-space-digest';
import { useRoomMentions } from '@/lib/use-room-mentions';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Txt } from '@/components/ui/Txt';

import { DigestSummary } from './DigestSummary';

interface SpaceDigestCardProps {
  spaceId: string | null;
}

export function SpaceDigestCard({ spaceId }: SpaceDigestCardProps) {
  const { settings } = useAiSettings();
  const { colors } = useTheme();
  const { status, summary, error, unreadCount, run, reset } = useSpaceDigest(spaceId);
  // Lets the summary's per-room headings link to their room.
  const resolveRoom = useRoomMentions(spaceId);

  // Hidden if AI is disabled or there's nothing unread (and we haven't already generated).
  if (!settings.enabled) return null;
  if (unreadCount === 0 && status === 'idle') return null;

  // Caught up: there's nothing to summarize, so keep it to a single quiet line
  // instead of a full titled card.
  if (status === 'empty') {
    return (
      <View style={styles.caughtUp}>
        <Icon name="check-circle" size={14} color={colors.accent} />
        <Txt variant="footnote" tone="inkMuted">
          You&apos;re all caught up
        </Txt>
      </View>
    );
  }

  return (
    <Card padded>
      {/* AI marker replaces a wordy title; loading status sits inline beside it,
          regenerate at the far right. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="sparkles" size={13} color={colors.accent} />
          {status === 'loading' || status === 'generating' ? (
            <>
              <ActivityIndicator size="small" color={colors.accent} />
              <Txt variant="footnote" tone="inkMuted" numberOfLines={1} style={styles.headerStatus}>
                {status === 'loading' ? 'Decrypting messages…' : 'Generating summary…'}
              </Txt>
            </>
          ) : null}
        </View>
        {status === 'ready' ? (
          <IconButton
            name="refresh"
            size={13}
            color={colors.accent}
            accessibilityLabel="Regenerate summary"
            onPress={() => {
              reset();
              void run();
            }}
          />
        ) : null}
      </View>
      {status === 'idle' ? (
        <View style={styles.prompt}>
          <Txt variant="subhead" weight="semibold" tabularNums>
            {unreadCount} unread{unreadCount === 1 ? ' message' : ' messages'}
          </Txt>
          <Txt variant="footnote" tone="inkMuted" style={styles.promptDetail}>
            Summarize what you missed across all rooms in this space — on-device, private.
          </Txt>
          <Button
            label="Summarize unread"
            variant="secondary"
            iconName="sparkles"
            onPress={run}
            style={styles.button}
          />
        </View>
      ) : status === 'loading' || status === 'generating' ? (
        <View style={styles.loading}>
          {/* Shimmering preview lines while the model streams */}
          <View style={styles.skeletons}>
            <Skeleton height={11} width="90%" />
            <Skeleton height={11} width="70%" style={styles.skRow} />
            <Skeleton height={11} width="80%" style={styles.skRow} />
          </View>
          {summary ? (
            <DigestSummary summary={summary} resolveRoom={resolveRoom} />
          ) : null}
        </View>
      ) : status === 'ready' ? (
        <DigestSummary summary={summary ?? ''} resolveRoom={resolveRoom} />
      ) : status === 'error' ? (
        <View style={styles.errorWrap}>
          <Txt variant="footnote" tone="danger">
            {error ?? 'Something went wrong generating the summary.'}
          </Txt>
          <Button
            label="Try again"
            variant="ghost"
            size="sm"
            iconName="refresh"
            onPress={run}
            style={styles.regenerate}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 18 },
  headerLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerStatus: { flexShrink: 1 },
  prompt: { gap: spacing.sm },
  promptDetail: { marginTop: 2 },
  button: { alignSelf: 'flex-start', marginTop: spacing.xs },
  loading: { gap: spacing.sm },
  skeletons: { gap: 6 },
  skRow: { marginTop: 0 },
  regenerate: { alignSelf: 'flex-start', marginTop: spacing.sm },
  errorWrap: { gap: spacing.sm },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
});
