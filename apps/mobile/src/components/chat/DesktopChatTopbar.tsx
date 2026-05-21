import { StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import type { RoomKind } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

interface DesktopChatTopbarProps {
  name: string;
  kind?: RoomKind;
  topic?: string;
  members?: number;
  onSearch?: () => void;
  onMembers?: () => void;
}

/**
 * The 52px toolbar above the main pane on desktop: room identity + topic on the
 * left, encryption/member affordances on the right. Replaces the centered
 * mobile {@link AppBar} when the app is in shell mode.
 */
export function DesktopChatTopbar({ name, kind = 'channel', topic, members, onSearch, onMembers }: DesktopChatTopbarProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { height: layout.desktopTopbarHeight, backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <Icon name={kind === 'dm' ? 'people' : kind === 'private' ? 'lock' : 'hash'} size={16} color={colors.inkSoft} />
      <Txt variant="subhead" weight="semibold" numberOfLines={1}>
        {name}
      </Txt>
      {topic ? (
        <>
          <View style={[styles.rule, { backgroundColor: colors.lineFaint }]} />
          <Txt variant="footnote" tone="inkMuted" numberOfLines={1} style={styles.topic}>
            {topic}
          </Txt>
        </>
      ) : (
        <View style={styles.spacer} />
      )}
      <Pill tone="accent" iconName="lock" label="E2EE" style={styles.pill} />
      {members != null ? <Pill iconName="people" label={String(members)} mono style={styles.pill} /> : null}
      <IconButton name="search" size={16} onPress={onSearch} accessibilityLabel="Search in room" />
      <IconButton name="people" size={16} onPress={onMembers} accessibilityLabel="View members" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  rule: { width: 1, height: 20 },
  topic: { flex: 1, minWidth: 0 },
  spacer: { flex: 1 },
  pill: { alignSelf: 'center' },
});
