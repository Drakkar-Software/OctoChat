import { StyleSheet, View } from 'react-native';

import { plural } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SpaceMetaProps {
  /** Owner + roster member count. */
  memberCount?: number | null;
  iconSize?: number;
  variant?: 'footnote' | 'micro';
  numberOfLines?: number;
}

/**
 * The encryption + membership line shown under a space's name. All spaces are
 * E2EE in the per-node access model — access is per room, but the space keyring
 * and access record are always encrypted. Single source of truth so the space
 * screen, the desktop sidebar and the mobile header never disagree.
 */
export function SpaceMeta({ memberCount, iconSize = 10, variant = 'micro', numberOfLines }: SpaceMetaProps) {
  const { colors } = useTheme();
  const label = memberCount != null
    ? `end-to-end encrypted · ${plural(memberCount, 'member')}`
    : 'end-to-end encrypted';
  return (
    <View style={styles.meta}>
      <Icon name="lock" size={iconSize} color={colors.accent} />
      <Txt variant={variant} tone="inkMuted" numberOfLines={numberOfLines}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
