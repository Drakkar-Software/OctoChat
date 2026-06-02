import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import type { ObjectNode } from '@/lib/types';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface BreadcrumbsProps {
  /** Root→current trail (inclusive), e.g. from `useObjects().breadcrumbs(id)`. */
  trail: ObjectNode[];
  /** Navigate to an ancestor; the last (current) crumb is rendered inert. */
  onNavigate?: (node: ObjectNode) => void;
}

/** Ancestor trail for a doc/project detail screen — walks the `parentId` chain so a
 *  deeply-nested sub-doc shows its full path. Pure composition over `Txt`/`Icon`. */
export function Breadcrumbs({ trail, onNavigate }: BreadcrumbsProps) {
  const { colors } = useTheme();
  if (trail.length === 0) return null;
  return (
    <View style={styles.row}>
      {trail.map((node, i) => {
        const isLast = i === trail.length - 1;
        return (
          <Fragment key={node.id}>
            {i > 0 ? (
              <View style={styles.sep}>
                <Icon name="chev" size={11} color={colors.inkFaint} />
              </View>
            ) : null}
            <Pressable
              accessibilityRole={isLast ? 'text' : 'button'}
              disabled={isLast || !onNavigate}
              onPress={isLast ? undefined : () => onNavigate?.(node)}
              style={styles.crumb}
            >
              {node.emoji ? (
                <Txt variant="caption" style={styles.emoji}>
                  {node.emoji}
                </Txt>
              ) : null}
              <Txt variant="caption" tone={isLast ? undefined : 'inkFaint'} weight={isLast ? 'bold' : undefined} numberOfLines={1}>
                {node.title}
              </Txt>
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 2, paddingBottom: spacing.sm },
  sep: { marginHorizontal: 1 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 200 },
  emoji: { fontSize: 12 },
});
