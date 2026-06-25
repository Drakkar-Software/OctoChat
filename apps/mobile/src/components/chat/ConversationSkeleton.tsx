import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { Skeleton } from '@/components/ui/Skeleton';

/** Avatar diameter — matches {@link MessageGroup} so the skeleton lands exactly
 *  where the real rows will, and the swap to live content reads as a fill-in. */
const AVATAR_SIZE = 36;

/** One placeholder row: a lead row carries an avatar + name line; a follow-up
 *  drops them (like a grouped continuation) and keeps the body aligned. */
function SkeletonRow({ lines, lead = true }: { lines: number[]; lead?: boolean }) {
  return (
    <View style={styles.row}>
      {lead ? (
        <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius={radii.pill} />
      ) : (
        <View style={styles.gutter} />
      )}
      <View style={styles.body}>
        {lead ? <Skeleton width={92} height={9} shimmer /> : null}
        {lines.map((w, i) => (
          <Skeleton key={i} width={`${w}%`} height={11} shimmer />
        ))}
      </View>
    </View>
  );
}

/**
 * Loading placeholder shaped like a {@link RoomConversation} — a few grouped
 * message rows — shown while a room opens (fetching keys + decrypting). Mirroring
 * the real layout makes the open feel like the conversation materializing rather
 * than a blank pane or a centered spinner.
 */
export function ConversationSkeleton() {
  return (
    <View style={styles.list}>
      <SkeletonRow lines={[64]} />
      <SkeletonRow lines={[48]} lead={false} />
      <SkeletonRow lines={[82, 57]} />
      <SkeletonRow lines={[38]} />
      <SkeletonRow lines={[71]} lead={false} />
      <SkeletonRow lines={[55, 88]} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screenX,
    paddingTop: spacing.md,
  },
  gutter: { width: AVATAR_SIZE },
  body: { flex: 1, gap: spacing.sm, paddingTop: 2 },
});
