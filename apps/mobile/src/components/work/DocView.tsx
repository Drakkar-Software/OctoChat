import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { blockMarkdown, useDoc } from '@/lib/use-doc';
import { useInlineEdit } from '@/lib/use-inline-edit';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { MarkdownBlock } from '@/components/doc/MarkdownBlock';

/**
 * Live doc body for one `doc` Object — the synced block list (merge-doc) rendered
 * as Markdown, each block tap-to-edit as raw Markdown. Block create/edit/split/
 * remove logic lives in {@link useDoc} + the `markdown` lib; this screen only maps
 * blocks and wires the editor. Title/emoji live on the index node (header).
 */
export function DocView({ spaceId, objectId, emoji, title }: { spaceId: string; objectId: string; emoji?: string; title?: string }) {
  const { colors } = useTheme();
  const { blocks, ready, offline, upsertBlock, editBlock, removeBlock } = useDoc(spaceId, objectId);
  const edit = useInlineEdit();

  const addBlock = () => {
    const id = upsertBlock({ type: 'md', text: '' });
    if (id) edit.begin(id);
  };

  // Cancelling a still-empty block (e.g. a freshly added one) drops it rather
  // than leaving a blank merge node behind.
  const cancel = (id: string, source: string) => {
    edit.close();
    if (!source.trim()) removeBlock(id);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        {emoji ? <Txt style={styles.emoji}>{emoji}</Txt> : null}
        <Txt variant="display" weight="bold">
          {title || 'Untitled'}
        </Txt>
      </View>

      {offline ? (
        <Callout tone="info" iconName="info">
          Offline — showing the last synced version.
        </Callout>
      ) : null}

      {blocks.length === 0 ? (
        <Callout tone="info" iconName="info">
          Empty doc. Add a block to start writing in Markdown.
        </Callout>
      ) : (
        blocks.map((b) => {
          const source = blockMarkdown(b);
          return (
            <MarkdownBlock
              key={b.id}
              source={source}
              editing={edit.isEditing(b.id)}
              onBeginEdit={() => edit.begin(b.id)}
              onSubmit={(text) => {
                editBlock(b.id, text);
                edit.close();
              }}
              onCancel={() => cancel(b.id, source)}
              onDelete={() => {
                if (edit.isEditing(b.id)) edit.close();
                removeBlock(b.id);
              }}
            />
          );
        })
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add block"
        disabled={!ready}
        onPress={addBlock}
        style={[styles.add, { borderColor: colors.lineFaint, opacity: ready ? 1 : 0.5 }]}
      >
        <Icon name="plus" size={13} color={colors.inkMuted} />
        <Txt variant="caption" tone="inkMuted">
          Add block
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emoji: { fontSize: 34 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.md, borderWidth: 1 },
});
