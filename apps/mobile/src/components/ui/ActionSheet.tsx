import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { useScalePress } from '@/lib/use-scale-press';
import { Divider } from './Divider';
import { Icon, type IconName } from './Icon';
import { Overlay } from './Overlay';
import { Txt } from './Txt';

export interface ActionSheetAction {
  label: string;
  iconName?: IconName;
  onPress: () => void;
  tone?: 'default' | 'danger';
  trailing?: ReactNode;
  /** Overrides the icon slot — for richer leading content (e.g. StatusPill). */
  leadingNode?: ReactNode;
  disabled?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: ActionSheetAction[];
  /** Optional footer rendered below the action list, above the cancel row. */
  footer?: ReactNode;
  /** Shown when `actions` is empty. */
  emptyLabel?: string;
}

function ActionRow({ action, onClose }: { action: ActionSheetAction; onClose: () => void }) {
  const { colors } = useTheme();
  const { animStyle, onPressIn, onPressOut } = useScalePress({ scaleTo: 0.97 });
  const iconColor = action.tone === 'danger' ? colors.danger : colors.ink;
  const textTone = action.tone === 'danger' ? 'danger' : undefined;

  return (
    <Animated.View style={animStyle}>
      <Pressable
        accessibilityRole="button"
        disabled={action.disabled}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => {
          action.onPress();
          onClose();
        }}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? colors.hover : 'transparent' },
          action.disabled && { opacity: 0.45 },
        ]}
      >
        {/* Leading slot: explicit leadingNode or icon */}
        {action.leadingNode != null ? (
          action.leadingNode
        ) : action.iconName != null ? (
          <Icon name={action.iconName} size={20} color={iconColor} />
        ) : null}

        <Txt variant="body" tone={textTone} style={styles.rowLabel}>
          {action.label}
        </Txt>

        {action.trailing != null ? action.trailing : null}
      </Pressable>
    </Animated.View>
  );
}

export function ActionSheet({ visible, onClose, title, actions, footer, emptyLabel }: ActionSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { animStyle: cancelAnimStyle, onPressIn: cancelIn, onPressOut: cancelOut } = useScalePress({ scaleTo: 0.97 });

  return (
    <Overlay visible={visible} onClose={onClose} placement="bottom">
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.paper,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
          },
        ]}
      >
        {title != null ? (
          <Txt variant="micro" weight="semibold" mono uppercase tone="inkSoft" style={styles.title}>
            {title}
          </Txt>
        ) : null}

        <View style={styles.list}>
          {actions.length === 0 && emptyLabel != null ? (
            <Txt variant="body" tone="inkMuted" style={styles.empty}>
              {emptyLabel}
            </Txt>
          ) : (
            actions.map((action, i) => (
              <ActionRow key={i} action={action} onClose={onClose} />
            ))
          )}
        </View>

        {footer != null ? <View style={styles.footer}>{footer}</View> : null}

        <Divider style={styles.divider} />

        <Animated.View style={cancelAnimStyle}>
          <Pressable
            accessibilityRole="button"
            onPressIn={cancelIn}
            onPressOut={cancelOut}
            onPress={onClose}
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: pressed ? colors.hover : 'transparent' },
            ]}
          >
            <Txt variant="body" weight="semibold" tone="inkMuted">
              Cancel
            </Txt>
          </Pressable>
        </Animated.View>
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.md,
  },
  title: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  rowLabel: {
    flex: 1,
  },
  empty: {
    padding: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  divider: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
});
