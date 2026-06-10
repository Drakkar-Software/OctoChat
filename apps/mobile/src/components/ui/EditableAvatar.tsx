import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface EditableAvatarProps {
  /** Monogram fallback when there's no image. */
  label: string;
  image?: string | null;
  size?: number;
  onPick: () => void;
  /** Shown only when an image is set. */
  onRemove?: () => void;
  uploadLabel?: string;
  changeLabel?: string;
  removeLabel?: string;
  error?: string | null;
  accessibilityLabel?: string;
  /** Heading content rendered above the actions (e.g. name + handle, or a section title). */
  children?: ReactNode;
}

/** Tappable avatar with a camera badge + Upload/Change/Remove actions and an inline
 *  error — the shared profile/space image editor (was copy-pasted across screens). */
export function EditableAvatar({
  label,
  image,
  size = 68,
  onPick,
  onRemove,
  uploadLabel = 'Upload photo',
  changeLabel = 'Change photo',
  removeLabel = 'Remove',
  error,
  accessibilityLabel = 'Change photo',
  children,
}: EditableAvatarProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPick} style={styles.wrap}>
        <Avatar label={label} image={image ?? undefined} size={size} />
        <View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.paper }]}>
          <Icon name="camera" size={12} color={colors.onAccent} />
        </View>
      </Pressable>
      <View style={styles.text}>
        {children}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={onPick} hitSlop={6}>
            <Txt variant="footnote" weight="semibold" tone="accent">
              {image ? changeLabel : uploadLabel}
            </Txt>
          </Pressable>
          {image && onRemove ? (
            <Pressable accessibilityRole="button" onPress={onRemove} hitSlop={6}>
              <Txt variant="footnote" weight="semibold" tone="danger">
                {removeLabel}
              </Txt>
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <Txt variant="micro" tone="danger">
            {error}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  wrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: layout.avatarBadge,
    height: layout.avatarBadge,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: 2 },
});
