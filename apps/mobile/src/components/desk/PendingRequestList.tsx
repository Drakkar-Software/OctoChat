import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { usePendingRequests } from '@/lib/use-pending-requests';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

import { RequestRow } from './RequestRow';

/** Loading skeleton — three shimmer blocks mimicking RequestRow cards. */
function RequestsSkeleton() {
  return (
    <View style={styles.skeleton}>
      {[72, 88, 72].map((h, i) => (
        <Skeleton key={i} height={h} width="100%" radius={8} shimmer />
      ))}
    </View>
  );
}

/**
 * Scrollable list of pending ticket/room requests for `spaceId`. Reads from the
 * shared `RequestsProvider` (same data as the sidebar badge) so the screen and the
 * count are always in sync. Empty-state and loading-skeleton are handled here so
 * the `/requests` route page stays thin.
 */
export function PendingRequestList({ spaceId }: { spaceId: string }) {
  const { pending, loading, error, acceptBusyId, declineBusyId, accept, decline } = usePendingRequests(spaceId);

  if (loading && pending.length === 0) {
    return <RequestsSkeleton />;
  }

  if (pending.length === 0) {
    return (
      <EmptyState
        iconName="check-circle"
        title="You're all caught up"
        subtitle="No pending requests for this space."
      />
    );
  }

  return (
    <View style={styles.list}>
      {error ? (
        <Callout tone="danger" iconName="alert">
          {error}
        </Callout>
      ) : null}
      {pending.map((p) => (
        <RequestRow
          key={p.req.reqId}
          entry={p}
          acceptBusy={acceptBusyId === p.req.reqId}
          declineBusy={declineBusyId === p.req.reqId}
          onAccept={() => void accept(p)}
          onDecline={() => void decline(p)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  skeleton: { gap: spacing.sm, paddingHorizontal: spacing.sm },
});
