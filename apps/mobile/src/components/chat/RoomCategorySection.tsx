import { Fragment, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Room, RoomKind } from '@/lib/types';
import type { ThreadSummary } from '@/lib/threads';
import type { RoomCategory } from '@/lib/use-rooms';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

import { ChannelRow } from './ChannelRow';
import { ThreadRow } from './ThreadRow';

interface RoomCategorySectionProps {
  category: RoomCategory;
  activeRoomId?: string;
  /** Recent threads of the active room — rendered indented under its row. */
  threads?: ThreadSummary[];
  onOpenRoom: (room: Room) => void;
  /** Open one of the active room's threads (the reply target's message id). */
  onOpenThread?: (parentId: string) => void;
  /** Create a room in this category. `kind` is `'channel'` (a normal room) or
   *  `'stream'` (an append-only Stream room). Resolves to an error message to show
   *  (e.g. only the owner may add rooms), or `null`/void on success. Omit to hide
   *  the add control. */
  onCreateRoom?: (category: string, name: string, kind: RoomKind) => Promise<string | null> | void;
}

/** A collapsible category header followed by its room rows. The active room's
 *  row is trailed by its most recent threads (when supplied). */
export function RoomCategorySection({
  category,
  activeRoomId,
  threads,
  onOpenRoom,
  onOpenThread,
  onCreateRoom,
}: RoomCategorySectionProps) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<RoomKind>('channel');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isStream = kind === 'stream';
  // Pressing a kind toggle blurs the (possibly empty) name input, which would
  // otherwise auto-close the add box before the toggle's onPress runs. This flag
  // (set on pointer-down, cleared after the toggle handler) tells onBlur to keep
  // the box open — so we only close on a genuine outside click of an empty input.
  const interactingWithToggle = useRef(false);

  const submit = async () => {
    const n = name.trim();
    setName('');
    setAdding(false);
    if (!n) return;
    const message = await onCreateRoom?.(category.name, n, kind);
    setError(typeof message === 'string' ? message : null);
  };

  return (
    <View style={styles.section}>
      {/* Collapse toggle and the add button are separate press targets so the
          "+" stays comfortably clickable and never just folds the category. */}
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => setCollapsed((c) => !c)} style={styles.toggle}>
          <Icon name={collapsed ? 'chev' : 'chevron-down'} size={12} color={colors.inkMuted} />
          <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
            {category.name}
          </Txt>
        </Pressable>
        {onCreateRoom ? (
          <IconButton
            name={adding ? 'x' : 'plus'}
            size={14}
            color={colors.inkMuted}
            accessibilityLabel={adding ? 'Cancel new room' : `Add a room to ${category.name}`}
            onPress={() => {
              setError(null);
              setCollapsed(false);
              setKind('channel');
              setAdding((a) => !a);
            }}
          />
        ) : null}
      </View>

      {!collapsed
        ? category.rooms.map((room) => (
            <Fragment key={room.id}>
              <ChannelRow room={room} active={room.id === activeRoomId} onPress={() => onOpenRoom(room)} />
              {room.id === activeRoomId && threads?.length
                ? threads.map((t) => (
                    <ThreadRow key={t.parentId} thread={t} onPress={() => onOpenThread?.(t.parentId)} />
                  ))
                : null}
            </Fragment>
          ))
        : null}

      {!collapsed && adding ? (
        <View style={styles.addBox}>
          {/* Channel (merge-doc) vs Stream (append-only). A Stream room is where
              bots/integrations post by appending — no pull/merge — so it's a distinct
              creation choice the owner makes up front (the kind is fixed at create). */}
          <View style={[styles.kindToggle, { borderColor: colors.lineSoft }]}>
            {(['channel', 'stream'] as const).map((k) => {
              const on = kind === k;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPressIn={() => {
                    interactingWithToggle.current = true;
                  }}
                  onPress={() => {
                    setKind(k);
                    // Clear after the blur that this press triggered has run.
                    setTimeout(() => {
                      interactingWithToggle.current = false;
                    }, 0);
                  }}
                  style={[styles.kindOption, { backgroundColor: on ? colors.accentSoft : 'transparent' }]}
                >
                  <Icon name={k === 'stream' ? 'stream' : 'hash'} size={12} color={on ? colors.accentInk : colors.inkMuted} />
                  <Txt variant="footnote" weight={on ? 'semibold' : 'regular'} color={on ? colors.accentInk : colors.inkMuted}>
                    {k === 'stream' ? 'Stream' : 'Channel'}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <TextField
            leadingIcon={isStream ? 'stream' : 'hash'}
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            onBlur={() => {
              if (!name.trim() && !interactingWithToggle.current) setAdding(false);
            }}
            placeholder={isStream ? 'new-stream' : 'new-channel'}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            containerStyle={[styles.addField, { backgroundColor: colors.paper }]}
          />
        </View>
      ) : null}

      {error ? (
        <View style={styles.notice}>
          <Callout tone="warning" iconName="lock">
            {error}
          </Callout>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md },
  addBox: { marginTop: spacing.xs },
  kindToggle: {
    flexDirection: 'row',
    marginHorizontal: spacing.xs,
    padding: 2,
    gap: 2,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  kindOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
    borderRadius: radii.sm,
  },
  addField: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
  notice: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
});
