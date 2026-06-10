import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface ListRowProps {
  /** The row's label text. */
  label: string;
  /** Leading glyph for non-avatar rows (channel/link). Ignored when `avatarLabel` is set. */
  iconName?: IconName;
  /** Render the leading slot as an {@link Avatar} monogram (DM rows) instead of an icon. */
  avatarLabel?: string;
  /** Peer's uploaded avatar image for DM rows; falls back to `avatarLabel` monogram. */
  avatarImage?: string;
  active?: boolean;
  /** Unread count badge on the right. */
  unread?: number;
  /** `@` mention marker (overrides `unread`). */
  mention?: boolean;
  /** Muted row: keeps its unread badge (silence-only) but reads quiet — never
   *  bolded by unread, badge dimmed, and a mute glyph precedes it. */
  muted?: boolean;
  onPress?: () => void;
  /** Long-press (native) — e.g. "Move to category…". */
  onLongPress?: () => void;
  /** Ref to the row's outer element — the web drag handle (see useDraggableRoom). */
  rowRef?: Ref<View>;
  /** Accessibility label override (defaults to `label`). */
  accessibilityLabel?: string;
  /** Optional node rendered after the label, before the unread badge (e.g. a
   *  status glyph). */
  trailing?: ReactNode;
}

/**
 * A single destination row in the sidebar / channel list — a leading glyph
 * (icon or avatar), a label, and an optional unread/mention badge. Active rows
 * carry an accent rail + wash; hovered rows (web) get a subtle highlight.
 *
 * ListRow owns the leading rendering so its color stays derived from the row's
 * own active/emphasis state — callers (e.g. {@link ChannelRow},
 * {@link SidebarLinkRow}) only map their data onto these props.
 */
export function ListRow({
  label,
  iconName,
  avatarLabel,
  avatarImage,
  active = false,
  unread,
  mention,
  muted = false,
  onPress,
  onLongPress,
  rowRef,
  accessibilityLabel,
  trailing,
}: ListRowProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const hasBadge = !!mention || (unread ?? 0) > 0;
  const emphasized = !muted && hasBadge;
  const labelColor = active ? colors.accentInk : emphasized ? colors.ink : colors.inkSoft;
  const bg = active
    ? hovered
      ? colors.accentSoftHover
      : colors.accentSoft
    : hovered
      ? colors.hover
      : 'transparent';

  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      onLongPress={onLongPress}
      {...hoverProps}
      style={[styles.row, { backgroundColor: bg }]}
    >
      {/* A single leading rail: accent for the open room, unread-tinted for an
          unread (but not-open) row so unread destinations punch out of the muted
          column at a glance. Muted rows stay quiet (emphasized is false). */}
      {active ? (
        <View style={[styles.rail, { backgroundColor: colors.accent }]} />
      ) : emphasized ? (
        <View style={[styles.rail, { backgroundColor: colors.unread }]} />
      ) : null}
      {avatarLabel != null ? (
        <Avatar label={avatarLabel} image={avatarImage} size={22} />
      ) : iconName ? (
        // Unread tints the glyph to accent too — the dead icon column becomes the
        // primary attention cue (active still wins with accent).
        <Icon name={iconName} size={15} color={active || emphasized ? colors.accent : colors.inkMuted} />
      ) : null}
      <Txt
        variant="subhead"
        weight={emphasized || active ? 'semibold' : 'regular'}
        color={labelColor}
        numberOfLines={1}
        style={styles.name}
      >
        {label}
      </Txt>
      {trailing}
      {muted ? <Icon name="volume-off" size={14} color={colors.inkMuted} /> : null}
      {muted ? (
        hasBadge ? (
          <View style={styles.mutedBadge}>
            <Badge count={unread} mention={mention} />
          </View>
        ) : null
      ) : (
        <Badge count={unread} mention={mention} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.rowY,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: 7,
    bottom: 7,
    width: 3,
    borderTopRightRadius: radii.xs,
    borderBottomRightRadius: radii.xs,
  },
  name: { flex: 1 },
  mutedBadge: { opacity: 0.45 },
});
