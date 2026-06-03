import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import type { ObjectNode } from '@/lib/types';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface BreadcrumbsProps {
  /** Root→parent ancestor trail (EXCLUSIVE of the current node), e.g. from
   *  `useObjects().ancestors(id)`. The current node is titled on its own screen, so
   *  it is NOT a crumb — every crumb here is an ancestor and stays navigable. */
  trail: ObjectNode[];
  /** Navigate to the tapped ancestor. */
  onNavigate?: (node: ObjectNode) => void;
}

/** Ancestor path for a doc/project detail screen — walks the `parentId` chain from
 *  the root down to the parent so a deeply-nested sub-doc shows where it lives. Empty
 *  (renders nothing) for a root-level node. Pure composition over `Txt`/`Icon`. */
export function Breadcrumbs({ trail, onNavigate }: BreadcrumbsProps) {
  const { colors } = useTheme();
  if (trail.length === 0) return null;
  return (
    <View style={styles.row}>
      {trail.map((node, i) => (
        <Fragment key={node.id}>
          {i > 0 ? (
            <View style={styles.sep}>
              <Icon name="chev" size={11} color={colors.inkFaint} />
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={!onNavigate}
            onPress={() => onNavigate?.(node)}
            style={styles.crumb}
          >
            {node.emoji ? (
              <Txt variant="caption" style={styles.emoji}>
                {node.emoji}
              </Txt>
            ) : null}
            <Txt variant="caption" tone="inkFaint" numberOfLines={1}>
              {node.title}
            </Txt>
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 2, paddingBottom: spacing.sm },
  sep: { marginHorizontal: 1 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 200 },
  emoji: { fontSize: 12 },
});
