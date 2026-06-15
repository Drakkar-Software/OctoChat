import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { authorFor } from '@drakkar.software/octochat-sdk';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

interface SpaceMembersCardProps {
  /** Recorded owner, or null for a space the viewer owns (legacy / their own). */
  ownerId: string | null;
  /** Non-owner roster from the space registry. */
  members: string[];
  currentUserId: string;
  /** Viewer is the space owner and settings have loaded — show remove controls. */
  canRemove?: boolean;
  /** Owner: remove a member from the roster. Throws on failure. */
  onRemove?: (userId: string) => Promise<void>;
}

interface MemberRowProps {
  id: string;
  user: { name: string; initials: string; avatar?: string | null };
  isOwnerRow: boolean;
  canRemove?: boolean;
  onRemove?: (userId: string) => Promise<void>;
}

/**
 * Single member row. Non-owner rows render a trailing trash `IconButton` for
 * owner viewers that expands into an inline "Remove? ✓ ✕" confirmation (mirrors
 * `MessageActions` delete confirm — see `src/components/chat/MessageActions.tsx`).
 * The row unmounts on success (`onRemove` triggers a refresh that drops it from
 * `members`), so no explicit success state is needed.
 */
function MemberRow({ id, user, isOwnerRow, canRemove, onRemove }: MemberRowProps) {
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!onRemove || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove member.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.row}>
        <Avatar size={32} label={user.initials} image={user.avatar} tint />
        <Txt variant="callout" weight="semibold" numberOfLines={1} style={styles.name}>
          {user.name}
        </Txt>
        {isOwnerRow ? <Pill tone="accent" label="owner" /> : null}
        {!isOwnerRow && canRemove ? (
          confirming ? (
            <>
              <Txt variant="footnote" weight="semibold" tone="danger">
                Remove?
              </Txt>
              <IconButton
                name="check"
                size={16}
                color={colors.danger}
                accessibilityLabel="Confirm remove"
                onPress={busy ? undefined : () => void handleConfirm()}
              />
              <IconButton
                name="x"
                size={16}
                color={colors.inkMuted}
                accessibilityLabel="Cancel"
                onPress={busy ? undefined : () => setConfirming(false)}
              />
            </>
          ) : (
            <IconButton
              name="trash"
              size={16}
              color={colors.danger}
              accessibilityLabel={`Remove ${user.name}`}
              onPress={() => {
                setError(null);
                setConfirming(true);
              }}
            />
          )
        ) : null}
      </View>
      {error ? (
        <Txt variant="footnote" tone="danger" style={styles.error}>
          {error}
        </Txt>
      ) : null}
    </>
  );
}

/**
 * MEMBERS card for the space screen. Lists the owner (once the space has grown
 * past just them) followed by the roster, each shown with their public pseudo +
 * avatar — resolved through the same shared profile cache the message stream
 * uses, so it adds no extra fetches. Falls back to a hint while a space is solo.
 * Owner viewers see a trailing remove control on each non-owner row.
 */
export function SpaceMembersCard({ ownerId, members, currentUserId, canRemove, onRemove }: SpaceMembersCardProps) {
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
              <MemberRow
                id={id}
                user={u}
                isOwnerRow={id === ownerUserId}
                canRemove={canRemove}
                onRemove={onRemove}
              />
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
  error: { marginTop: 2 },
});
