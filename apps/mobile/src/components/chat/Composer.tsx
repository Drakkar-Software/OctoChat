import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { formatBytes } from '@/lib/format';
import { tapFeedback } from '@/lib/haptics';
import { pickFile, type PickedFile } from '@/lib/pick-file';
import { QUICK_REACTIONS } from '@/lib/reactions';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface ComposerProps {
  placeholder: string;
  /** Send text and/or a picked file. May be async (e.g. while the file uploads). */
  onSend?: (text: string, file?: PickedFile) => void | Promise<void>;
}

/** Message input bar — attach a file, insert an emoji, and send. */
export function Composer({ placeholder, onSend }: ComposerProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const hasContent = text.trim().length > 0 || !!pending;

  const submit = async () => {
    if (!hasContent || busy) return;
    setBusy(true);
    try {
      await onSend?.(text.trim(), pending ?? undefined);
      setText('');
      setPending(null);
      setEmojiOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    tapFeedback();
    const file = await pickFile();
    if (file) setPending(file);
  };

  const insertEmoji = (emoji: string) => {
    tapFeedback();
    setText((t) => t + emoji);
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.paper, borderTopColor: colors.lineSoft }]}>
      {emojiOpen ? (
        <View style={[styles.palette, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${emoji}`}
              onPress={() => insertEmoji(emoji)}
              style={styles.paletteItem}
            >
              <Txt variant="subhead">{emoji}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      {pending ? (
        <View style={[styles.pending, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
          <Icon name={pending.mime.startsWith('image/') ? 'image' : 'file'} size={15} color={colors.accent} />
          <View style={styles.pendingText}>
            <Txt variant="footnote" weight="medium" numberOfLines={1}>
              {pending.name}
            </Txt>
            <Txt variant="micro" mono tone="inkMuted">
              {formatBytes(pending.bytes.length)}
            </Txt>
          </View>
          <IconButton name="x" size={14} accessibilityLabel="Remove attachment" onPress={() => setPending(null)} />
        </View>
      ) : null}

      <View style={[styles.bar, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
        <IconButton name="plus" size={18} color={colors.inkSoft} accessibilityLabel="Attach a file" onPress={attach} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { color: colors.ink }]}
          multiline
          numberOfLines={1}
          editable={!busy}
        />
        <IconButton
          name="smile"
          size={18}
          color={emojiOpen ? colors.accent : colors.inkSoft}
          accessibilityLabel="Insert emoji"
          onPress={() => {
            tapFeedback();
            setEmojiOpen((v) => !v);
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasContent || busy }}
          accessibilityLabel="Send"
          disabled={!hasContent || busy}
          onPress={submit}
          style={[styles.send, { backgroundColor: hasContent ? colors.accent : colors.fill }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Icon name="send" size={15} color={hasContent ? colors.onAccent : colors.inkMuted} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
  },
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    padding: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  paletteItem: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginBottom: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  pendingText: { flexShrink: 1, minWidth: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingLeft: spacing.md,
    paddingRight: 6,
    borderRadius: radii.sheet,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: typeScale.body.fontSize,
    maxHeight: 96,
    paddingTop: 0,
    paddingBottom: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
