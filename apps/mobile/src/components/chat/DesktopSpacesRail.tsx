import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { glowShadow, layout, radii, spacing } from '@/theme';
import type { Space } from '@drakkar.software/octochat-sdk';
import { DM_HOME_NAME } from '@/lib/dm-home';
import { useHover } from '@/lib/use-hover';
import { useMutes } from '@/lib/mutes-context';
import { reorderBy, useReorderableSpace } from '@/lib/use-space-reorder';
import { useTheme } from '@/lib/use-theme';
import { AccountSwitcherPopover } from '@/components/account/AccountSwitcherPopover';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface DesktopSpacesRailProps {
  spaces: Space[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  /** Select the virtual DM space (the leading tile that lists every DM). */
  onSelectDms?: () => void;
  /** Whether the DM space is the active selection. */
  dmsActive?: boolean;
  /** Aggregate unread across all DMs, for the DM tile badge. */
  dmUnread?: number;
  /** Bottom avatar / gear → the current identity's profile. */
  meLabel: string;
  /** The current identity's uploaded avatar (data URI), if any. */
  meAvatar?: string;
  onOpenProfile?: () => void;
  /** Persist a new rail order after a drag-and-drop reorder (web only). Omitted ⇒
   *  tiles are not draggable. */
  onReorder?: (orderedIds: string[]) => void;
}

function SpaceTile({
  spaceId,
  label,
  image,
  active,
  unread,
  muted,
  onPress,
  onDropSpace,
}: {
  spaceId: string;
  label: string;
  image?: string;
  active: boolean;
  unread?: number;
  muted?: boolean;
  onPress?: () => void;
  /** Fires when another tile is dropped onto this one (web drag-reorder). Omitted ⇒
   *  the tile isn't a drag source/target. */
  onDropSpace?: (draggedId: string, targetId: string) => void;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const [over, setOver] = useState(false);
  // Web-only: makes the tile draggable + a drop target. `onDropSpace` undefined keeps
  // the ref inert (the hook still binds, but nothing reorders). Native returns an inert
  // ref regardless (see use-space-reorder.native).
  const dragRef = useReorderableSpace(
    spaceId,
    (draggedId) => onDropSpace?.(draggedId, spaceId),
    onDropSpace ? setOver : undefined,
  );
  return (
    <Pressable
      ref={onDropSpace ? dragRef : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      style={styles.tileWrap}
    >
      <View
        style={[
          styles.tile,
          {
            borderRadius: active ? radii.lg : hovered || over ? radii.lg : radii.xl,
            backgroundColor: active ? colors.accent : hovered ? colors.accentBg : colors.fill,
            borderColor: over ? colors.accent : active ? 'transparent' : hovered ? colors.accentBorder : colors.lineFaint,
            borderWidth: active && !over ? 0 : 1,
          },
          active ? glowShadow(colors.glow, 0.3, 8) : null,
        ]}
      >
        {image ? (
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label} />
        ) : (
          <Txt variant="footnote" weight="bold" mono color={active ? colors.onAccent : hovered ? colors.accentInk : colors.inkSoft}>
            {label}
          </Txt>
        )}
      </View>
      <View style={[styles.corner, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
        <Icon name="lock" size={9} color={colors.inkMuted} />
      </View>
      {muted ? (
        <View style={[styles.muteCorner, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
          <Icon name="volume-off" size={9} color={colors.inkMuted} />
        </View>
      ) : null}
      {unread ? (
        <View style={styles.badge}>
          <Badge count={unread} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Vertical spaces rail pinned to the left edge of the desktop shell: the DM-home
 * tile, one monogram tile per space (active tile squares off, others stay
 * rounded), an add button, then the current identity at the foot.
 */
export function DesktopSpacesRail({
  spaces,
  activeId,
  onSelect,
  onAdd,
  onSelectDms,
  dmsActive,
  dmUnread,
  meLabel,
  meAvatar,
  onOpenProfile,
  onReorder,
}: DesktopSpacesRailProps) {
  const { colors } = useTheme();
  const { isSpaceMuted } = useMutes();
  const [menuOpen, setMenuOpen] = useState(false);
  // A tile reports (dragged, target); compute the resulting id order from the current
  // list (which the rail holds) and hand it to the persister. No-op moves return the
  // same array, which the provider/registry treat as a no-write.
  const onDropSpace = onReorder
    ? (draggedId: string, targetId: string) => onReorder(reorderBy(spaces.map((s) => s.id), draggedId, targetId))
    : undefined;
  return (
    <View style={[styles.rail, { width: layout.railWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
      {/* The tile column scrolls vertically when spaces outgrow the viewport; the
          identity foot stays pinned below it. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Virtual DM space — pinned first, lists every DM (see lib/dm-home). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={DM_HOME_NAME}
          onPress={onSelectDms}
          style={styles.tileWrap}
        >
          <View
            style={[
              styles.tile,
              {
                borderRadius: dmsActive ? radii.lg : radii.xl,
                backgroundColor: dmsActive ? colors.accent : colors.fill,
                borderColor: dmsActive ? 'transparent' : colors.lineFaint,
                borderWidth: dmsActive ? 0 : 1,
              },
              dmsActive ? glowShadow(colors.glow, 0.3, 8) : null,
            ]}
          >
            <Icon name="dm" size={20} color={dmsActive ? colors.onAccent : colors.inkSoft} />
          </View>
          {dmUnread ? (
            <View style={styles.badge}>
              <Badge count={dmUnread} />
            </View>
          ) : null}
          {/* DMs are E2EE private spaces — same lock corner as any private space. */}
          <View style={[styles.corner, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
            <Icon name="lock" size={9} color={colors.inkMuted} />
          </View>
        </Pressable>
        {spaces.map((s) => (
          <SpaceTile
            key={s.id}
            spaceId={s.id}
            label={s.short}
            image={s.image}
            active={s.id === activeId}
            unread={s.unread}
            muted={isSpaceMuted(s.id)}
            onPress={() => onSelect?.(s.id)}
            onDropSpace={onDropSpace}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create or join a space"
          onPress={onAdd}
          style={[styles.tile, styles.add, { borderColor: colors.lineSoft }]}
        >
          <Icon name="plus" size={16} color={colors.inkMuted} />
        </Pressable>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Accounts"
        onPress={() => setMenuOpen(true)}
        style={styles.foot}
      >
        <Avatar label={meLabel} image={meAvatar} size={32} ring={menuOpen} />
      </Pressable>
      <AccountSwitcherPopover visible={menuOpen} onClose={() => setMenuOpen(false)} onViewProfile={onOpenProfile} />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    paddingVertical: spacing.md,
    borderRightWidth: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  scroll: { alignSelf: 'stretch', flex: 1 },
  // Vertical padding clears the absolutely-positioned unread badges from the scroll clip.
  scrollContent: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  tileWrap: { position: 'relative' },
  tile: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  add: { borderRadius: radii.xl, borderWidth: 1, borderStyle: 'dashed' },
  badge: { position: 'absolute', top: -5, right: -5 },
  corner: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteCorner: {
    position: 'absolute',
    bottom: -3,
    left: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: { alignItems: 'center', gap: spacing.sm },
});
