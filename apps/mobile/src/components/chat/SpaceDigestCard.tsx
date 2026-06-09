/**
 * "Catch me up" — on-demand AI summary of unread messages across a space.
 * Appears on the per-space room list when there are unread messages and AI is enabled.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useAiSettings } from '@/lib/ai-settings-context';
import { useSpaceDigest } from '@/lib/ai/use-space-digest';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Markdown } from '@/components/ui/Markdown';
import { Skeleton } from '@/components/ui/Skeleton';
import { Txt } from '@/components/ui/Txt';

interface SpaceDigestCardProps {
  spaceId: string | null;
}

export function SpaceDigestCard({ spaceId }: SpaceDigestCardProps) {
  const { settings } = useAiSettings();
  const { colors } = useTheme();
  const { status, summary, error, unreadCount, run, reset } = useSpaceDigest(spaceId);

  // Hidden if AI is disabled or there's nothing unread (and we haven't already generated).
  if (!settings.enabled) return null;
  if (unreadCount === 0 && status === 'idle') return null;

  return (
    <Card title="CATCH ME UP" padded>
      {status === 'idle' ? (
        <View style={styles.prompt}>
          <View style={styles.promptHeader}>
            <Icon name="sparkles" size={15} color={colors.accent} />
            <Txt variant="subhead" weight="semibold">
              {unreadCount} unread{unreadCount === 1 ? ' message' : ' messages'}
            </Txt>
          </View>
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
          <View style={styles.loadingHeader}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Txt variant="footnote" tone="inkMuted">
              {status === 'loading' ? 'Decrypting messages…' : 'Generating summary…'}
            </Txt>
          </View>
          {/* Shimmering preview lines while the model streams */}
          <View style={styles.skeletons}>
            <Skeleton height={11} width="90%" />
            <Skeleton height={11} width="70%" style={styles.skRow} />
            <Skeleton height={11} width="80%" style={styles.skRow} />
          </View>
          {summary ? (
            <Markdown source={summary} />
          ) : null}
        </View>
      ) : status === 'ready' ? (
        <View>
          <Markdown source={summary ?? ''} />
          <Button
            label="Regenerate"
            variant="ghost"
            size="sm"
            iconName="refresh"
            onPress={() => { reset(); void run(); }}
            style={styles.regenerate}
          />
        </View>
      ) : status === 'empty' ? (
        <EmptyState
          iconName="check-circle"
          title="You're all caught up"
          subtitle="No unread messages from others in this space."
        />
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
  prompt: { gap: spacing.sm },
  promptHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  promptDetail: { marginTop: 2 },
  button: { alignSelf: 'flex-start', marginTop: spacing.xs },
  loading: { gap: spacing.sm },
  loadingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skeletons: { gap: 6 },
  skRow: { marginTop: 0 },
  regenerate: { alignSelf: 'flex-start', marginTop: spacing.sm },
  errorWrap: { gap: spacing.sm },
});
