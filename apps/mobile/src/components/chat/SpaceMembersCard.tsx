import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { authorFor } from '@drakkar.software/octochat-sdk';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

interface SpaceMembersCardProps {
  /** Recorded owner, or null for a space the viewer owns (legacy / their own). */
  ownerId: string | null;
  /** Non-owner roster from the space registry. */
  members: string[];
  currentUserId: string;
}

/**
 * MEMBERS card for the space screen. Lists the owner (once the space has grown
 * past just them) followed by the roster, each shown with their public pseudo +
 * avatar — resolved through the same shared profile cache the message stream
 * uses, so it adds no extra fetches. Falls back to a hint while a space is solo.
 */
export function SpaceMembersCard({ ownerId, members, currentUserId }: SpaceMembersCardProps) {
  // usePseudos/useAvatars read a module-level cache the React Compiler can't
  // track; without opting out, the row JSX memoizes stale here because the
  // accessors' identity stays stable while members[] does. See use-pseudos.ts.
  'use no memo';
  const ownerUserId = ownerId ?? currentUserId;
  const memberCount = 1 + members.length; // owner + roster
  // Owner first, then the roster; surface the owner row only when there's more
  // than one member, else the empty-roster hint reads cleaner.
  const ids = members.length === 0 ? [] : [ownerUserId, ...members.filter((m) => m !== ownerUserId)];
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);

  return (
    <Card title={`MEMBERS · ${memberCount}`}>
      {ids.length === 0 ? (
        <Txt variant="footnote" tone="inkMuted">
          Just the owner so far.
        </Txt>
      ) : (
        ids.map((id, i) => {
          const u = authorFor(id, currentUserId, pseudo(id), avatar(id));
          return (
            <Fragment key={id}>
              {i > 0 ? <Divider style={styles.divider} /> : null}
              <View style={styles.row}>
                <Avatar size={32} label={u.initials} image={u.avatar} tint />
                <Txt variant="callout" weight="semibold" numberOfLines={1} style={styles.name}>
                  {u.name}
                </Txt>
                {id === ownerUserId ? <Pill tone="accent" label="owner" /> : null}
              </View>
            </Fragment>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, minWidth: 0 },
  divider: { marginVertical: spacing.xs },
});
