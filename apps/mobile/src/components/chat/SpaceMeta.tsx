import { StyleSheet, View } from 'react-native';

import { plural } from '@/lib/format';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SpaceMetaProps {
  /** Public spaces are plaintext (server-readable); private spaces are E2EE. */
  isPublic: boolean;
  /** Member count for private spaces (owner + roster). Omit/null for public
   *  spaces, which have no roster (access is cap-based, not membership). */
  memberCount?: number | null;
  iconSize?: number;
  variant?: 'footnote' | 'micro';
  numberOfLines?: number;
}

/**
 * The encryption + membership line shown under a space's name. Single source of
 * truth so the space screen, the desktop sidebar and the mobile header never
 * disagree on a space's encryption status or member count.
 */
export function SpaceMeta({ isPublic, memberCount, iconSize = 10, variant = 'micro', numberOfLines }: SpaceMetaProps) {
  const { colors } = useTheme();
  const label = isPublic
    ? 'public · not encrypted'
    : memberCount != null
      ? `end-to-end encrypted · ${plural(memberCount, 'member')}`
      : 'end-to-end encrypted';
  return (
    <View style={styles.meta}>
      <Icon name={isPublic ? 'globe' : 'lock'} size={iconSize} color={isPublic ? colors.inkMuted : colors.accent} />
      <Txt variant={variant} tone="inkMuted" numberOfLines={numberOfLines}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
