import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { SpaceView } from '@/lib/spaces-context';
import { DM_HOME_NAME } from '@/lib/dm-home';
import { useTheme } from '@/lib/use-theme';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

import { ListRow } from './ListRow';

interface SpacePickerProps {
  spaces: SpaceView[];
  /** The active selection (a space id, or the DM-home sentinel). */
  activeId: string;
  isDmHome?: boolean;
  /** Aggregate DM unread, badged on the DM-home row. */
  dmUnread?: number;
  onSelectSpace: (id: string) => void;
  onSelectDms?: () => void;
  onAddSpace: () => void;
  onBrowseSpaces: () => void;
  /** When provided, an edit toggle appears in the heading that reveals up/down
   *  reorder controls per row. Hidden while filtering. */
  onMoveSpace?: (id: string, dir: -1 | 1) => void;
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
  onBrowseSpaces,
  onMoveSpace,
}: SpacePickerProps) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const showMoveControls = editing && !filtering && !!onMoveSpace;

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
        <EmptyState iconName="search" title="No spaces" subtitle={`Nothing matches "${query.trim()}".`} />
      ) : (
        <View style={styles.list}>
          <View style={styles.headingRow}>
            <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted" style={styles.heading}>
              Spaces
            </Txt>
            {onMoveSpace && !filtering ? (
              <IconButton
                name={editing ? 'check' : 'edit'}
                size={14}
                onPress={() => setEditing((e) => !e)}
                accessibilityLabel={editing ? 'Done editing order' : 'Edit space order'}
              />
            ) : null}
          </View>
          {/* The DM home row is web/desktop-only — native has a dedicated bottom tab. */}
          {!filtering && Platform.OS === 'web' ? (
            <ListRow iconName="people" label={DM_HOME_NAME} active={isDmHome} unread={dmUnread} onPress={onSelectDms} />
          ) : null}
          {matches.map((s, idx) => (
            <View key={s.id} style={showMoveControls ? styles.editRow : undefined}>
              {showMoveControls ? (
                <View style={styles.moveButtons}>
                  <IconButton
                    name="chevron-up"
                    size={16}
                    color={idx === 0 ? colors.inkFaint : colors.inkSoft}
                    onPress={idx === 0 ? undefined : () => onMoveSpace(s.id, -1)}
                    accessibilityLabel="Move space up"
                  />
                  <IconButton
                    name="chevron-down"
                    size={16}
                    color={idx === matches.length - 1 ? colors.inkFaint : colors.inkSoft}
                    onPress={idx === matches.length - 1 ? undefined : () => onMoveSpace(s.id, 1)}
                    accessibilityLabel="Move space down"
                  />
                </View>
              ) : null}
              <View style={showMoveControls ? styles.editRowContent : undefined}>
                <ListRow
                  avatarLabel={s.short ?? s.name.slice(0, 2).toUpperCase()}
                  avatarImage={s.image ?? undefined}
                  label={s.name}
                  active={!isDmHome && s.id === activeId}
                  unread={s.unread}
                  onPress={showMoveControls ? undefined : () => onSelectSpace(s.id)}
                />
              </View>
            </View>
          ))}
          {!filtering ? (
            <>
              <View style={[styles.divider, { backgroundColor: colors.lineFaint }]} />
              <ListRow iconName="plus" label="Join or create a space" onPress={onAddSpace} />
              <ListRow iconName="globe" label="Browse spaces" onPress={onBrowseSpaces} />
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
  headingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  heading: { flex: 1, letterSpacing: 0.6 },
  divider: { height: 1, marginVertical: spacing.xs, marginHorizontal: spacing.md },
  editRow: { flexDirection: 'row', alignItems: 'center' },
  moveButtons: { flexDirection: 'column', paddingLeft: spacing.xs, gap: 0 },
  editRowContent: { flex: 1 },
});
