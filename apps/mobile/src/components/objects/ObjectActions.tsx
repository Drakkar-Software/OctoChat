import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { radii, spacing } from '@/theme';
import type { ObjectNode } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

// keyboard-controller KAV lifts the bottom-anchored sheet above the keyboard
// (works under Android edge-to-edge); on web the keyboard never overlays, so a
// plain View passthrough — same pattern as StackScreen.
const KAV = Platform.OS === 'web' ? View : KeyboardAvoidingView;

interface ObjectActionsProps {
  /** The object being acted on (doc/project/…); actions disable until it loads. */
  node: ObjectNode | undefined;
  /** Persist a title/emoji change (wired to `useObjects.rename` in the route). */
  onRename: (patch: { title?: string; emoji?: string }) => void;
  /** Archive the object (wired to `useObjects.archive`); the route handles nav. */
  onArchive: () => void;
}

/**
 * Header action menu for any {@link ObjectNode}: rename its title/emoji or archive
 * it. Presentational — rename/archive logic lives in `useObjects` (passed in), so
 * this works for docs, projects and any future object type unchanged. Built on RN
 * `Modal` as a bottom sheet, mirroring {@link MoveToCategorySheet}.
 */
export function ObjectActions({ node, onRename, onArchive }: ObjectActionsProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('');

  const show = () => {
    setTitle(node?.title ?? '');
    setEmoji(node?.emoji ?? '');
    setOpen(true);
  };
  const save = () => {
    const t = title.trim();
    onRename({ title: t || 'Untitled', emoji: emoji.trim() || undefined });
    setOpen(false);
  };

  return (
    <>
      <IconButton name="dots-v" size={20} color={colors.ink} onPress={show} accessibilityLabel="Object actions" />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <KAV style={styles.kav} behavior="padding">
          <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={() => setOpen(false)} accessibilityLabel="Dismiss">
            <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
              <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted" style={styles.title}>
                Edit {node?.type ?? 'object'}
              </Txt>
              <View style={styles.fields}>
                <TextField value={emoji} onChangeText={setEmoji} placeholder="Emoji" accessibilityLabel="Emoji" containerStyle={styles.emoji} />
                <TextField value={title} onChangeText={setTitle} placeholder="Title" accessibilityLabel="Title" autoFocus containerStyle={styles.titleField} />
              </View>
              <View style={styles.row}>
                <Button label="Save" variant="primary" size="sm" onPress={save} />
                <Button label="Cancel" variant="ghost" size="sm" onPress={() => setOpen(false)} />
                <View style={styles.spacer} />
                <Button
                  label="Archive"
                  variant="danger"
                  size="sm"
                  iconName="trash"
                  onPress={() => {
                    setOpen(false);
                    onArchive();
                  }}
                />
              </View>
            </Pressable>
          </Pressable>
        </KAV>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { paddingTop: spacing.md, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg, gap: spacing.md, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
  title: { paddingBottom: spacing.xs },
  fields: { flexDirection: 'row', gap: spacing.sm },
  emoji: { width: 72 },
  titleField: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
});
