import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useRevealActions } from '@/lib/use-reveal-actions';
import { useTheme } from '@/lib/use-theme';
import { AutosaveField } from '@/components/ui/AutosaveField';
import { IconButton } from '@/components/ui/IconButton';
import { Markdown } from '@/components/ui/Markdown';

interface MarkdownBlockProps {
  /** Markdown source for this block (already projected from the stored block). */
  source: string;
  editing: boolean;
  onBeginEdit: () => void;
  /** Persist the edited Markdown — autosaved. `final` (blur/unmount) is when the doc
   *  hook may split/remove; debounce ticks save in place. */
  onCommit: (text: string, opts: { final: boolean }) => void;
  /** Leave edit mode (unmounts the field → final flush). */
  onClose: () => void;
  onDelete: () => void;
}

/**
 * One doc block: rendered Markdown that swaps to an inline {@link AutosaveField}
 * (raw Markdown) on tap — edits autosave, no Save/Cancel. Editing/merge logic lives
 * in the doc hook + `markdown` lib; this cell only wires the interaction. The delete
 * affordance reveals on hover (web) or long-press (native) via {@link useRevealActions}.
 */
export function MarkdownBlock({ source, editing, onBeginEdit, onCommit, onClose, onDelete }: MarkdownBlockProps) {
  const { colors } = useTheme();
  const { revealed, rowProps, onLongPress, hide } = useRevealActions();

  if (editing) {
    return (
      <View style={styles.editing}>
        <AutosaveField initialText={source} onCommit={onCommit} onClose={onClose} commitEmpty finalizeAlways multiline accessibilityLabel="Edit block" />
      </View>
    );
  }

  return (
    <View {...rowProps} style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit block"
        onPress={onBeginEdit}
        onLongPress={onLongPress}
        style={styles.body}
      >
        <Markdown source={source} />
      </Pressable>
      {revealed ? (
        <IconButton
          name="trash"
          size={15}
          color={colors.inkMuted}
          onPress={() => {
            hide();
            onDelete();
          }}
          accessibilityLabel="Delete block"
          style={styles.del}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  body: { flex: 1, borderRadius: radii.sm, paddingVertical: 2 },
  del: { marginTop: 2 },
  editing: { paddingVertical: spacing.xs },
});
