import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import { joinBlocks, useDoc, type DocBlock } from '@/lib/use-doc';
import { useTheme } from '@/lib/use-theme';
import { AutosaveField } from '@/components/ui/AutosaveField';
import { Callout } from '@/components/ui/Callout';
import { Markdown } from '@/components/ui/Markdown';
import { Txt } from '@/components/ui/Txt';
import { ObjectHero } from '@/components/work/ObjectHero';

/**
 * Live doc body for one `doc` Object — ONE seamless Markdown surface, not a block list:
 * the reader renders the whole doc, tapping it swaps to a single autosaving textarea over
 * the entire Markdown. Blocks exist only as the merge granularity under the hood
 * ({@link useDoc} + {@link mergeDocEdit}) — the user never sees or creates a "block".
 *
 * On open we snapshot the block list ({@link baseRef}) so the save is a 3-way merge:
 * only the paragraphs the user actually changed are written, and a concurrent edit to
 * another paragraph (pulled in over SSE while editing) survives. Title/emoji live on the
 * index node (header).
 */
export function DocView({ spaceId, objectId, emoji, title }: { spaceId: string; objectId: string; emoji?: string; title?: string }) {
  const { colors } = useTheme();
  const { blocks, text, ready, offline, mergeText } = useDoc(spaceId, objectId);
  const [editing, setEditing] = useState(false);
  // The block list as it was when editing began — the merge base (see mergeDocEdit).
  const baseRef = useRef<DocBlock[]>([]);

  const beginEdit = () => {
    baseRef.current = blocks;
    setEditing(true);
  };

  return (
    <View style={styles.wrap}>
      <ObjectHero emoji={emoji} title={title} />

      {offline ? (
        <Callout tone="info" iconName="info">
          Offline — showing the last synced version.
        </Callout>
      ) : null}

      {editing ? (
        <AutosaveField
          initialText={joinBlocks(baseRef.current)}
          // Advance the merge base after each commit so a multi-tick insert carries its own
          // id forward (else every debounce tick would re-mint and duplicate it).
          onCommit={(t) => {
            baseRef.current = mergeText(baseRef.current, t);
          }}
          onClose={() => setEditing(false)}
          commitEmpty
          multiline
          minHeight={layout.docEditorMinHeight}
          placeholder="Write in Markdown…"
          accessibilityLabel="Edit document"
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit document"
          disabled={!ready}
          onPress={beginEdit}
          style={({ pressed }) => [styles.reader, pressed ? { backgroundColor: colors.hover } : null]}
        >
          {text.trim() ? (
            <Markdown source={text} />
          ) : (
            <Txt variant="body" tone="inkFaint">
              Tap to start writing…
            </Txt>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  reader: { minHeight: layout.docEditorMinHeight, borderRadius: radii.md, paddingVertical: spacing.xs },
});
