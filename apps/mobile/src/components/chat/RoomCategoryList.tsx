import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Room } from '@drakkar.software/octochat-sdk';
import type { ThreadSummary } from '@drakkar.software/octochat-sdk';
import { DEFAULT_CATEGORY } from '@drakkar.software/octochat-sdk';
import type { RoomCategory } from '@/lib/use-rooms';
import { useCategoryCollapse } from '@/lib/use-category-collapse';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { StaggerList } from '@/components/ui/StaggerList';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';



import { CreateRoomSheet } from './CreateRoomSheet';

import { MoveToCategorySheet } from './MoveToCategorySheet';
import { RoomCategorySection } from './RoomCategorySection';

// Spaces whose room list has already played its entrance cascade this session — so
// the "dive" is a once-per-space delight on first open, not a re-blank on every
// switch back (the sidebar is the highest-traffic surface in the app).
const divedSpaces = new Set<string>();

interface RoomCategoryListProps {
  categories: RoomCategory[];
  activeRoomId?: string;
  threads?: ThreadSummary[];
  /** Identity + space — the key for persisted per-category collapse state. */
  userId: string;
  spaceId: string;
  onOpenRoom: (room: Room) => void;
  onOpenThread?: (parentId: string) => void;
  /** Add a room to a category. Pass `isPublic` to make it world-readable (plaintext).
   *  Omit to hide the per-category "+". */
  onCreateRoom?: (category: string, name: string, isPublic?: boolean) => Promise<string | null> | void;
  /** OWNER-ONLY (pass only when the viewer owns the space): re-home a room into a
   *  category. Present ⇒ rows are draggable (web) + long-pressable (native). */
  onMoveRoom?: (roomId: string, category: string) => Promise<string | null> | void;
  /** OWNER-ONLY: create a category. Present ⇒ the "New category" control shows. */
  onCreateCategory?: (name: string) => Promise<string | null> | void;
}

/** The space's rooms grouped into collapsible, drop-target categories, plus an
 *  owner-only "New category" control. Shared by the desktop sidebar and the mobile
 *  rooms tab so the list behaves identically on both. Collapse state is persisted
 *  per identity+space (categories are expanded by default); the category holding the
 *  active room is force-expanded so an open channel is never hidden. */
export function RoomCategoryList({
  categories,
  activeRoomId,
  threads,
  userId,
  spaceId,
  onOpenRoom,
  onOpenThread,
  onCreateRoom,
  onMoveRoom,
  onCreateCategory,
}: RoomCategoryListProps) {
  const { colors } = useTheme();
  const { isCollapsed, toggle } = useCategoryCollapse(userId, spaceId);
  const [moving, setMoving] = useState<Room | null>(null);
  const [addingCat, setAddingCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const names = categories.map((c) => c.name);

  const submitCategory = async () => {
    const n = catName.trim();
    setCatName('');
    setAddingCat(false);
    if (!n) return;
    const message = await onCreateCategory?.(n);
    setCatError(typeof message === 'string' ? message : null);
  };

  // Cascade only the FIRST time this space's list is shown this session.
  const firstDive = useMemo(() => {
    const seen = divedSpaces.has(spaceId);
    if (!seen) divedSpaces.add(spaceId);
    return !seen;
  }, [spaceId]);

  const sections = categories.map((cat) => {
    const containsActive = !!activeRoomId && cat.rooms.some((r) => r.id === activeRoomId);
    const collapsed = isCollapsed(cat.name) && !containsActive;
    return (
      <RoomCategorySection
        key={cat.name}
        category={cat}
        activeRoomId={activeRoomId}
        threads={threads}
        collapsed={collapsed}
        onToggleCollapse={() => toggle(cat.name)}
        onOpenRoom={onOpenRoom}
        onOpenThread={onOpenThread}
        onCreateRoom={onCreateRoom}
        onMoveRoom={onMoveRoom ? (roomId) => onMoveRoom(roomId, cat.name) : undefined}
        onRequestMove={onMoveRoom ? (room) => setMoving(room) : undefined}
      />
    );
  });

  return (
    <View>
      {/* "Dive into a space": the category sections cascade in the first time a space
          is opened (once per space per session, never on scroll / re-visit), and
          collapse to instant under reduced motion. */}
      {firstDive ? <StaggerList cap={6}>{sections}</StaggerList> : sections}

      {/* Empty-space "New channel" CTA — only when there are no categories yet. */}
      {categories.length === 0 && onCreateRoom ? (
        <View style={styles.emptyCta}>
          <Button
            label="New channel"
            iconName="hash"
            variant="primary"
            onPress={() => setAddingRoom(true)}
          />
        </View>
      ) : null}

      <CreateRoomSheet
        visible={addingRoom}
        onClose={() => setAddingRoom(false)}
        defaultCategory={DEFAULT_CATEGORY}
        onSubmit={(name, category, isPublic) => onCreateRoom?.(category, name, isPublic)}
      />

      {/* "New category" only shown once rooms exist — in the empty state we offer
          "New channel" above so the first action is always creating a room. */}
      {onCreateCategory && categories.length > 0 ? (
        addingCat ? (
          <TextField
            leadingIcon="folder"
            value={catName}
            onChangeText={setCatName}
            onSubmitEditing={submitCategory}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Escape') setAddingCat(false);
            }}
            placeholder="New category"
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            containerStyle={[styles.addCatField, { backgroundColor: colors.paper }]}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New category"
            onPress={() => {
              setCatError(null);
              setAddingCat(true);
            }}
            style={styles.addCat}
          >
            <Icon name="plus" size={12} color={colors.inkMuted} />
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
              New category
            </Txt>
          </Pressable>
        )
      ) : null}

      {catError ? (
        <View style={styles.notice}>
          <Callout tone="warning" iconName="alert">
            {catError}
          </Callout>
        </View>
      ) : null}

      <MoveToCategorySheet
        visible={!!moving}
        room={moving}
        categories={names}
        onSelect={(c) => {
          if (moving) void onMoveRoom?.(moving.id, c);
        }}
        onClose={() => setMoving(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  addCat: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  addCatField: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
  notice: { marginHorizontal: spacing.xs, marginTop: spacing.xs },
  emptyCta: { alignItems: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },
});
