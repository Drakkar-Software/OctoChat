import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { opacity, radii, spacing } from '@/theme';
import { useObjects } from '@/lib/use-objects';
import { buildTree, type ObjectTreeNode } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { useHover } from '@/lib/use-hover';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { ObjectTree, useTreeCollapse } from '@/components/objects/ObjectTree';

import { WorkEmpty } from './WorkEmpty';

/**
 * Live Work surface: the space's docs + projects from the unified object index,
 * rendered as the same collapsible {@link ObjectTree} the chat sidebar uses — no
 * card wrapper, so the tab reads like the chat channel list (a doc with sub-docs is
 * a collapsible folder). Rooms/categories are chat concerns and filtered out. Create
 * controls sit in a chat-style footer, mirroring the rooms list's "New category".
 */
export function WorkObjects({ spaceId, hero, live }: { spaceId: string | null; hero?: boolean; live?: boolean }) {
  const router = useRouter();
  const enabled = !!spaceId;
  // `live` opts into focus-refresh (see {@link useObjects}); set it only where this
  // mounts on a router SCREEN (the mobile Work tab), never in the persistent desktop
  // sidebar, whose host has no focus/blur to drive useFocusEffect.
  const { nodes, create, ready, loaded } = useObjects(spaceId ?? '', { enabled, liveSync: live });
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

  // The full-bleed empty state (with its own create CTAs) takes over the Work tab once
  // the index has loaded empty — gated on `loaded`, NOT `ready`, so a populated
  // workspace never flashes the pitch mid-load. The desktop sidebar (no `hero`) keeps
  // its compact inline empty text + footer controls instead.
  if (hero && loaded && tree.length === 0) {
    return <WorkEmpty onNewDoc={newDoc} onNewProject={newProject} disabled={!ready} />;
  }

  return (
    <View style={styles.panel}>
      {tree.length > 0 ? (
        <ObjectTree nodes={tree} onOpen={openNode} collapsed={collapsed} onToggle={toggle} />
      ) : (
        <Txt variant="caption" tone="inkFaint" style={styles.empty}>
          {loaded ? 'No docs or projects yet.' : 'Opening workspace…'}
        </Txt>
      )}
      <View style={styles.creates}>
        <CreateControl label="New doc" onPress={newDoc} disabled={!ready} />
        <CreateControl label="New project" onPress={newProject} disabled={!ready} />
      </View>
    </View>
  );
}

/** A footer create affordance styled like the rooms list's "New category" — plus
 *  glyph + micro/mono/uppercase label, quiet until hovered (web). */
function CreateControl({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      {...hoverProps}
      style={[styles.create, { backgroundColor: hovered && !disabled ? colors.hover : 'transparent', opacity: disabled ? opacity.disabled : 1 }]}
    >
      <Icon name="plus" size={12} color={colors.inkMuted} />
      <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 2 },
  empty: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  creates: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  create: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radii.md },
});
