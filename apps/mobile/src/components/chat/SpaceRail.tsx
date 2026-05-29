import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SpaceRailProps {
  spaces: Space[];
  activeId: string;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
}

function RailItem({
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
        {image ? (
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label} />
        ) : (
          <Txt variant="caption" weight="bold" mono color={active ? colors.accentInk : colors.inkSoft}>
            {label}
          </Txt>
        )}
      </View>
      <View style={[styles.corner, { backgroundColor: colors.paper, borderColor: colors.lineSoft }]}>
        <Icon name={isPublic ? 'globe' : 'lock'} size={8} color={colors.inkMuted} />
      </View>
      {unread ? (
        <View style={styles.badge}>
          <Badge count={unread} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Horizontal rail of space monograms with per-space unread badges. */
export function SpaceRail({ spaces, activeId, onSelect, onAdd }: SpaceRailProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.rail}>
      {spaces.map((s) => (
        <RailItem
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
});
