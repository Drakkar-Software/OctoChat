import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { paperBorder, radii, shadows, spacing } from '@/theme';
import { useObjects } from '@/lib/use-objects';
import { buildTree, type ObjectTreeNode } from '@/lib/starfish/objects';
import { useTheme } from '@/lib/use-theme';
import { useHover } from '@/lib/use-hover';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { ObjectTree, useTreeCollapse } from '@/components/objects/ObjectTree';

import { WorkHero } from './WorkHero';

/**
 * Live Work surface: the space's docs + projects from the unified object index,
 * rendered as a collapsible tree (sub-docs nest recursively). Rooms/categories are
 * chat concerns and filtered out here. New doc/project creation appends to the index.
 */
export function WorkObjects({ spaceId, hero }: { spaceId: string | null; hero?: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const enabled = !!spaceId;
  const { nodes, create, ready, opening } = useObjects(spaceId ?? '', { enabled });
  const { collapsed, toggle } = useTreeCollapse();

  // Work scope: only docs + projects (and their nesting). buildTree repairs any node
  // whose parent was filtered out (a root doc) by reparenting it to the forest root.
  const tree = useMemo(() => buildTree(nodes.filter((n) => n.type === 'doc' || n.type === 'project')), [nodes]);

  const openNode = (node: ObjectTreeNode) =>
    router.push({
      pathname: node.type === 'project' ? '/work/project/[id]' : '/work/doc/[id]',
      params: { id: node.id, spaceId: spaceId ?? '', emoji: node.emoji ?? '', label: node.title, hint: '' },
    });

  const newDoc = () => {
    const id = create({ type: 'doc', title: 'Untitled', emoji: '📄' });
    if (id) router.push({ pathname: '/work/doc/[id]', params: { id, spaceId: spaceId ?? '', emoji: '📄', label: 'Untitled', hint: '' } });
  };
  const newProject = () => {
    const id = create({ type: 'project', title: 'Untitled', emoji: '🗂️' });
    if (id) router.push({ pathname: '/work/project/[id]', params: { id, spaceId: spaceId ?? '', emoji: '🗂️', label: 'Untitled', hint: '' } });
  };

  return (
    <View style={styles.panel}>
      {hero ? <WorkHero /> : null}
      <View style={[styles.tile, paperBorder(colors), shadows.sm]}>
        <View style={styles.head}>
          <Txt variant="caption" weight="bold" tone="inkMuted" style={styles.headTitle}>
            DOCS &amp; PROJECTS
          </Txt>
          <AddButton label="Doc" onPress={newDoc} disabled={!ready} />
          <AddButton label="Project" onPress={newProject} disabled={!ready} />
        </View>
        {tree.length > 0 ? (
          <ObjectTree nodes={tree} onOpen={openNode} collapsed={collapsed} onToggle={toggle} />
        ) : (
          <Txt variant="caption" tone="inkFaint" style={styles.empty}>
            {opening ? 'Opening workspace…' : 'No docs or projects yet. Create one above.'}
          </Txt>
        )}
      </View>
    </View>
  );
}

function AddButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`New ${label}`}
      onPress={onPress}
      disabled={disabled}
      {...hoverProps}
      style={[styles.add, { backgroundColor: hovered && !disabled ? colors.hover : 'transparent', borderColor: colors.lineFaint, opacity: disabled ? 0.5 : 1 }]}
    >
      <Icon name="plus" size={12} color={colors.inkMuted} />
      <Txt variant="caption" tone="inkMuted">
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  tile: { borderRadius: radii.card, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  headTitle: { flex: 1, letterSpacing: 0.5 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.xs, borderWidth: 1 },
  empty: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
});
