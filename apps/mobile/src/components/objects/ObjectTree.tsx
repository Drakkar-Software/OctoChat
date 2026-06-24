import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ReactNode } from 'react';

import { layout, motion, radii, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { iconForNode } from '@drakkar.software/octochat-sdk';
import type { ObjectTreeNode } from '@drakkar.software/octochat-sdk';
import type { ID } from '@drakkar.software/octochat-sdk';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface ObjectTreeProps {
  nodes: ObjectTreeNode[];
  onOpen: (node: ObjectTreeNode) => void;
  /** Ids collapsed on this device (local state lives in the parent so it survives
   *  re-render; the tree itself is stateless about persistence). */
  collapsed: Set<ID>;
  onToggle: (id: ID) => void;
}

/**
 * Recursive, collapsible object tree — the sidebar + Work surface for the unified
 * {@link ObjectTreeNode} model. Rows indent by depth; a node with children shows a
 * disclosure chevron that toggles its subtree. Collapse state is per-device (held by
 * the caller, not synced). Pure composition over `Icon`/`Txt` + theme tokens.
 */
export function ObjectTree({ nodes, onOpen, collapsed, onToggle }: ObjectTreeProps) {
  return (
    <View>
      {nodes.map((node) => (
        <ObjectTreeRow key={node.id} node={node} onOpen={onOpen} collapsed={collapsed} onToggle={onToggle} />
      ))}
    </View>
  );
}

function ObjectTreeRow({ node, onOpen, collapsed, onToggle }: { node: ObjectTreeNode } & Omit<ObjectTreeProps, 'nodes'>) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const reduced = useReducedMotion();
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isCategory = node.type === 'category';

  // Animate the disclosure chevron between closed (0°) and open (90°) so the tree reads
  // as breathing open rather than snapping. Reduced motion → settles instantly.
  const turn = useSharedValue(isCollapsed ? 0 : 1);
  useEffect(() => {
    const to = isCollapsed ? 0 : 1;
    turn.set(reduced ? to : withTiming(to, { duration: motion.fast }));
  }, [isCollapsed, reduced, turn]);
  const chevStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 90}deg` }] }));

  const open = useCallback(() => {
    if (isCategory) onToggle(node.id);
    else onOpen(node);
  }, [isCategory, node, onOpen, onToggle]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={node.title}
        onPress={open}
        {...hoverProps}
        style={[
          styles.row,
          { paddingLeft: spacing.xs + node.depth * layout.objectTreeIndent, backgroundColor: hovered ? colors.hover : 'transparent' },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isCollapsed ? 'Expand' : 'Collapse'}
          hitSlop={6}
          onPress={hasChildren ? () => onToggle(node.id) : undefined}
          style={styles.disclosure}
        >
          {hasChildren ? (
            <Animated.View style={chevStyle}>
              <Icon name="chev" size={12} color={colors.inkFaint} />
            </Animated.View>
          ) : null}
        </Pressable>
        {node.emoji ? (
          <Txt variant="subhead" style={styles.emoji}>
            {node.emoji}
          </Txt>
        ) : (
          <View style={styles.leafIcon}>
            <Icon name={iconForNode(node) as IconName} size={13} color={colors.inkMuted} />
          </View>
        )}
        <Txt
          variant={isCategory ? 'caption' : 'subhead'}
          weight={isCategory ? 'bold' : undefined}
          tone={isCategory ? 'inkMuted' : undefined}
          numberOfLines={1}
          style={styles.label}
        >
          {isCategory ? node.title.toUpperCase() : node.title}
        </Txt>
      </Pressable>
      {hasChildren && !isCollapsed ? (
        // Fade the subtree in as it mounts so expansion reads as the tree opening, not a
        // hard cut. Collapse stays an instant unmount (the row's chevron carries the close).
        <SubtreeReveal>
          <ObjectTree nodes={node.children} onOpen={onOpen} collapsed={collapsed} onToggle={onToggle} />
        </SubtreeReveal>
      ) : null}
    </>
  );
}

/** A one-shot fade-in on mount for an expanded subtree. FadeView only animates on a
 *  visibility *change*, so a freshly-mounted subtree needs its own 0→1 entrance — the
 *  same shared-value pattern used by the brand seals. Honors reduced motion. */
function SubtreeReveal({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    opacity.set(withTiming(1, { duration: motion.base }));
  }, [reduced, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Caller-side hook for the per-device collapse set (keep tree rendering pure). */
export function useTreeCollapse(): { collapsed: Set<ID>; toggle: (id: ID) => void } {
  const [collapsed, setCollapsed] = useState<Set<ID>>(() => new Set());
  const toggle = useCallback((id: ID) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: layout.objectTreeRowHeight, paddingRight: spacing.sm, borderRadius: radii.md },
  disclosure: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  emoji: { width: 18, textAlign: 'center' },
  leafIcon: { width: 18, alignItems: 'center' },
  label: { flex: 1, minWidth: 0, letterSpacing: 0 },
});
