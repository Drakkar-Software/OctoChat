import type { ReactNode, Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface CollapsibleSectionProps {
  label: string;
  /** Faint count shown next to the label (hides when falsy). */
  count?: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Optional node rendered at the trailing end of the header (e.g. a "+" button). */
  headerTrailing?: ReactNode;
  /** Rows/content — rendered only when not collapsed. */
  children?: ReactNode;
  /** Ref forwarded to the root View (e.g. for a drop-zone target on web). */
  containerRef?: Ref<View>;
  /** Additional style merged into the root View (e.g. drag-over accent wash). */
  style?: StyleProp<ViewStyle>;
}

/**
 * The collapsible shelf wrapper shared by {@link RoomCategorySection} and the
 * "Tickets" magic category in {@link TicketList}. Renders a top-ruled section with
 * a chevron toggle, an uppercase mono label, an optional faint count, an optional
 * trailing header node, and the children rows (hidden when collapsed).
 *
 * Intentionally layout-only — no data, no hooks, no drag-drop logic.
 */
export function CollapsibleSection({
  label,
  count,
  collapsed,
  onToggleCollapse,
  headerTrailing,
  children,
  containerRef,
  style,
}: CollapsibleSectionProps) {
  const { colors } = useTheme();

  return (
    <View
      ref={containerRef}
      style={[
        styles.section,
        { borderTopColor: colors.ruleSoft },
        style,
      ]}
    >
      {/* Collapse toggle and the trailing action are separate press targets so the
          trailing button stays comfortably clickable and never just folds the section. */}
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onToggleCollapse} style={styles.toggle}>
          <Icon name={collapsed ? 'chev' : 'chevron-down'} size={12} color={colors.inkMuted} />
          <Txt variant="caption" weight="bold" mono uppercase tone="inkMuted" numberOfLines={1} style={styles.label}>
            {label}
          </Txt>
          {/* A faint count so even a collapsed shelf communicates its size. */}
          {count ? (
            <Txt variant="caption" mono tone="inkFaint">
              {count}
            </Txt>
          ) : null}
        </Pressable>
        {headerTrailing}
      </View>

      {!collapsed ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A shelf: a lit top hairline + a touch of breathing room above it groups each
  // category's rows. The 1px frame stays (transparent at rest) so the drag-over
  // accent border has somewhere to paint without shifting layout.
  section: {
    marginBottom: spacing.sm,
    paddingTop: spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radii.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 6, paddingHorizontal: spacing.md },
  label: { flex: 1 },
});
