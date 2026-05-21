import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { QUICK_REACTIONS } from '@/lib/reactions';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface ComposerProps {
  placeholder: string;
  onSend?: (text: string) => void;
}

/** Message input bar — emoji insert + send. Send is disabled until there's text. */
export function Composer({ placeholder, onSend }: ComposerProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const hasText = text.trim().length > 0;

  const submit = () => {
    if (!hasText) return;
    tapFeedback();
    onSend?.(text.trim());
    setText('');
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
      <View style={[styles.bar, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { color: colors.ink }]}
          multiline
          numberOfLines={1}
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
          accessibilityState={{ disabled: !hasText }}
          accessibilityLabel="Send"
          disabled={!hasText}
          onPress={submit}
          style={[styles.send, { backgroundColor: hasText ? colors.accent : colors.fill }]}
        >
          <Icon name="send" size={15} color={hasText ? colors.onAccent : colors.inkMuted} />
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
