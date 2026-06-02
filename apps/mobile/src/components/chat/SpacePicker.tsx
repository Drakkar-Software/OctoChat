import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { DM_HOME_NAME } from '@/lib/dm-home';
import { useTheme } from '@/lib/use-theme';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

import { ListRow } from './ListRow';

interface SpacePickerProps {
  spaces: Space[];
  /** The active selection (a space id, or the DM-home sentinel). */
  activeId: string;
  isDmHome?: boolean;
  /** Aggregate DM unread, badged on the DM-home row. */
  dmUnread?: number;
  onSelectSpace: (id: string) => void;
  onSelectDms: () => void;
  onAddSpace: () => void;
}

/**
 * Full-screen space switcher body: a filter field over the identity's spaces,
 * the Direct Messages home, and a join/create entry — the mobile-friendly
 * replacement for the old {@link SpaceSwitcher} dropdown. Filtering hides the
 * DM-home and join rows once the user types so the list reads as pure results;
 * an empty query shows everything, like the resting switcher did.
 */
export function SpacePicker({
  spaces,
  activeId,
  isDmHome = false,
  dmUnread = 0,
  onSelectSpace,
  onSelectDms,
  onAddSpace,
}: SpacePickerProps) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;

  const matches = useMemo(
    () => (filtering ? spaces.filter((s) => s.name.toLowerCase().includes(q)) : spaces),
    [spaces, filtering, q],
  );

  return (
    <View style={styles.root}>
      <TextField
        leadingIcon="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Filter spaces…"
        autoCorrect={false}
        autoCapitalize="none"
      />

      {filtering && matches.length === 0 ? (
        <EmptyState iconName="search" title="No spaces" subtitle={`Nothing matches “${query.trim()}”.`} />
      ) : (
        <View style={styles.list}>
          <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted" style={styles.heading}>
            Spaces
          </Txt>
          {/* The DM home and join rows are navigation chrome, not search hits — keep
              them only at rest so a query reduces the list to matching spaces. */}
          {!filtering ? (
            <ListRow iconName="people" label={DM_HOME_NAME} active={isDmHome} unread={dmUnread} onPress={onSelectDms} />
          ) : null}
          {matches.map((s) => (
            <ListRow
              key={s.id}
              avatarLabel={s.short}
              avatarImage={s.image}
              label={s.name}
              active={!isDmHome && s.id === activeId}
              unread={s.unread}
              onPress={() => onSelectSpace(s.id)}
            />
          ))}
          {!filtering ? (
            <>
              <View style={[styles.divider, { backgroundColor: colors.lineFaint }]} />
              <ListRow iconName="plus" label="Join or create a space" onPress={onAddSpace} />
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.md },
  list: { gap: 2 },
  heading: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, letterSpacing: 0.6 },
  divider: { height: 1, marginVertical: spacing.xs, marginHorizontal: spacing.md },
});
