import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { glowShadow, layout, radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { AccountSwitcherPopover } from '@/components/account/AccountSwitcherPopover';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Octopus } from '@/components/brand/Octopus';
import { Txt } from '@/components/ui/Txt';

interface DesktopSpacesRailProps {
  spaces: Space[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  /** Open the Threads view (all of the active space's threads). */
  onOpenThreads?: () => void;
  /** Bottom avatar / gear → the current identity's profile. */
  meLabel: string;
  /** The current identity's uploaded avatar (data URI), if any. */
  meAvatar?: string;
  onOpenProfile?: () => void;
}

function SpaceTile({
  label,
  image,
  active,
  unread,
  isPublic,
  onPress,
}: {
  label: string;
  image?: string;
  active: boolean;
  unread?: number;
  isPublic?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} {...hoverProps} style={styles.tileWrap}>
      <View
        style={[
          styles.tile,
          {
            borderRadius: active ? radii.lg : hovered ? radii.lg : radii.xl,
            backgroundColor: active ? colors.accent : hovered ? colors.accentBg : colors.fill,
            borderColor: active ? 'transparent' : hovered ? colors.accentBorder : colors.lineFaint,
            borderWidth: active ? 0 : 1,
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
        <Icon name={isPublic ? 'globe' : 'lock'} size={9} color={colors.inkMuted} />
      </View>
      {unread ? (
        <View style={styles.badge}>
          <Badge count={unread} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Vertical spaces rail pinned to the left edge of the desktop shell: the brand
 * mark, one monogram tile per space (active tile squares off, others stay
 * rounded), an add button, then the current identity at the foot.
 */
export function DesktopSpacesRail({
  spaces,
  activeId,
  onSelect,
  onAdd,
  onOpenThreads,
  meLabel,
  meAvatar,
  onOpenProfile,
}: DesktopSpacesRailProps) {
  const { colors } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View style={[styles.rail, { width: layout.railWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
      <Octopus size={28} />
      <View style={[styles.rule, { backgroundColor: colors.lineFaint }]} />
      {spaces.map((s) => (
        <SpaceTile
          key={s.id}
          label={s.short}
          image={s.image}
          active={s.id === activeId}
          unread={s.unread}
          isPublic={(s.type ?? 'private') === 'public'}
          onPress={() => onSelect?.(s.id)}
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
      <View style={styles.spacer} />
      {onOpenThreads ? (
        <IconButton name="thread" size={20} onPress={onOpenThreads} accessibilityLabel="Threads" />
      ) : null}
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
  rule: { width: 28, height: 1, marginVertical: spacing.xs },
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
  spacer: { flex: 1 },
  foot: { alignItems: 'center', gap: spacing.sm },
});
