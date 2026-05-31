import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { useMutes } from '@/lib/mutes-context';
import { useTheme } from '@/lib/use-theme';
import { DM_HOME_SHORT } from '@/lib/dm-home';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SpaceRailProps {
  spaces: Space[];
  activeId: string;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  /** Select the virtual DM space (the leading tile that lists every DM). */
  onSelectDms?: () => void;
  /** Whether the DM space is the active selection. */
  dmsActive?: boolean;
  /** Aggregate unread across all DMs, for the DM tile badge. */
  dmUnread?: number;
}

function RailItem({
  label,
  image,
  icon,
  active,
  unread,
  isPublic,
  privacy,
  muted,
  onPress,
}: {
  label: string;
  image?: string;
  /** When set, render this glyph centered instead of an image/monogram. The privacy
   *  corner is dropped for icon tiles UNLESS `privacy` is set — used by the virtual
   *  DM tile, which is an E2EE private space and shows the same lock as any space. */
  icon?: IconName;
  active: boolean;
  unread?: number;
  isPublic?: boolean;
  /** Force-show the privacy corner even on an icon tile (the virtual DM tile). */
  privacy?: boolean;
  muted?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.itemWrap}>
      <View
        style={[
          styles.tile,
          {
            // Active reads as a framed "selected chip": a bold accent border that
            // also frames image tiles (the image fills inside the border, so the
            // ring shows even when an opaque avatar covers the fill — the old
            // solid-accent fill was invisible behind images). The squircle shape
            // and light accent fill reinforce it for monogram tiles.
            borderRadius: active ? radii.md : radii.lg,
            backgroundColor: active ? colors.accentBg : colors.fill,
            borderColor: active ? colors.accent : colors.lineFaint,
            borderWidth: active ? 2 : 1,
          },
        ]}
      >
        {icon ? (
          <Icon name={icon} size={18} color={active ? colors.accentInk : colors.inkSoft} />
        ) : image ? (
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label} />
        ) : (
          <Txt variant="caption" weight="bold" mono color={active ? colors.accentInk : colors.inkSoft}>
            {label}
          </Txt>
        )}
      </View>
      {icon && !privacy ? null : (
        <View style={[styles.corner, { backgroundColor: colors.paper, borderColor: colors.lineSoft }]}>
          <Icon name={isPublic ? 'globe' : 'lock'} size={8} color={colors.inkMuted} />
        </View>
      )}
      {muted ? (
        <View style={[styles.muteCorner, { backgroundColor: colors.paper, borderColor: colors.lineSoft }]}>
          <Icon name="volume-off" size={8} color={colors.inkMuted} />
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

/** Horizontal rail of space monograms with per-space unread badges. */
export function SpaceRail({ spaces, activeId, onSelect, onAdd, onSelectDms, dmsActive, dmUnread }: SpaceRailProps) {
  const { colors } = useTheme();
  const { isSpaceMuted } = useMutes();
  return (
    <View style={styles.rail}>
      {/* Virtual DM space — pinned first, lists every DM (see lib/dm-home). */}
      <RailItem label={DM_HOME_SHORT} icon="dm" privacy active={!!dmsActive} unread={dmUnread} onPress={onSelectDms} />
      {spaces.map((s) => (
        <RailItem
          key={s.id}
          label={s.short}
          image={s.image}
          active={s.id === activeId}
          unread={s.unread}
          isPublic={(s.type ?? 'private') === 'public'}
          muted={isSpaceMuted(s.id)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  itemWrap: { position: 'relative' },
  tile: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  add: { borderRadius: radii.lg, borderWidth: 1, borderStyle: 'dashed' },
  badge: { position: 'absolute', top: -5, right: -5 },
  corner: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteCorner: {
    position: 'absolute',
    bottom: -3,
    left: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
