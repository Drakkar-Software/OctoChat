import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';

interface ComposerProps {
  placeholder: string;
  onSend?: (text: string) => void;
}

/** Message input bar — attach/media/emoji actions + mic→send toggle. */
export function Composer({ placeholder, onSend }: ComposerProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const hasText = text.trim().length > 0;

  const submit = () => {
    if (hasText) {
      onSend?.(text.trim());
      setText('');
    }
    tapFeedback();
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.paper, borderTopColor: colors.lineSoft }]}>
      <View style={[styles.bar, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
        <IconButton name="plus" size={18} color={colors.inkSoft} accessibilityLabel="Add attachment" />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { color: colors.ink }]}
          multiline
        />
        <IconButton name="image" size={18} color={colors.inkSoft} accessibilityLabel="Add image" />
        <IconButton name="smile" size={18} color={colors.inkSoft} accessibilityLabel="Add emoji" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasText ? 'Send' : 'Record voice message'}
          onPress={submit}
          style={[styles.send, { backgroundColor: colors.accent }]}
        >
          <Icon name={hasText ? 'send' : 'mic'} size={15} color={colors.onAccent} />
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
    paddingVertical: 4,
    maxHeight: 96,
    includeFontPadding: false,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
