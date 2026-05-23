import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { submitOnEnterCancelOnEsc } from '@/lib/composer-keys';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

interface MessageEditorProps {
  /** The current message text to seed the editor with. */
  initialText: string;
  /** Commit the trimmed new text. Not called when the text is empty. */
  onSubmit: (text: string) => void;
  /** Abandon the edit and restore the original. */
  onCancel: () => void;
}

/**
 * Inline editor shown in place of a message's body while editing it. A multiline
 * {@link TextField} with Save/Cancel; on web bare Enter saves and Escape cancels
 * (Shift+Enter inserts a newline). Removing a message is the delete action's job,
 * so an empty edit can't be saved.
 */
export function MessageEditor({ initialText, onSubmit, onCancel }: MessageEditorProps) {
  const [text, setText] = useState(initialText);
  const canSave = text.trim().length > 0;

  const save = () => {
    const t = text.trim();
    if (t) onSubmit(t);
  };

  return (
    <View style={styles.wrap}>
      <TextField
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        accessibilityLabel="Edit message"
        onKeyPress={submitOnEnterCancelOnEsc(save, onCancel)}
      />
      <View style={styles.actions}>
        <Button label="Save" variant="primary" size="sm" disabled={!canSave} onPress={save} />
        <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
